// Chạy code thật của 10 block lọc AI (đọc từ production) với trang / dữ liệu giả lập từ bộ ca, AI gọi thật như Desktop.
// Mỗi ca thành một bài / comment có UID tác giả riêng để đọc lại quyết định của block. Tuỳ chọn tiêm lỗi vào lượt gọi AI.
'use strict'
const vm = require('node:vm')
const lib = require('./lib.cjs')

const POST_BLOCKS = [2859, 2554, 2863, 2602, 2904, 2718]
const COMMENT_BLOCKS = [2864, 2603, 2905, 2719]
const ENGINE = new Set([2859, 2863, 2864, 2904, 2905])
const SEEDING = new Set([2859, 2554])
const COMMENTS = new Set(COMMENT_BLOCKS)
const FALLBACK = 'fb_ai_content_filter_fallback'
const UNAVAILABLE = 'AI lọc bài tạm thời không dùng được'

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

// Lỗi tiêm: thay câu trả lời của một lượt gọi (không gọi AI thật cho lượt đó).
const FAULTS = [
  ['http529', () => ({ ok: false, content: '', error: 'AI trả về lỗi 529: Overloaded' })],
  ['http500', () => ({ ok: false, content: '', error: 'AI trả về lỗi 500: Internal error' })],
  ['http402', () => ({ ok: false, content: '', error: 'AI trả về lỗi 402: Insufficient Balance' })],
  ['http401', () => ({ ok: false, content: '', error: 'AI trả về lỗi 401: invalid x-api-key' })],
  ['fetch', () => ({ ok: false, content: '', error: 'fetch failed' })],
  ['timeout', () => ({ ok: false, content: '', error: 'The operation was aborted due to timeout' })],
  ['empty', () => ({ ok: false, content: '', error: 'AI không trả về nội dung.' })],
  ['prose', () => ({ ok: true, content: 'Có, bài viết này phù hợp với mô tả.' })],
  ['string_bool', () => ({ ok: true, content: '{"matched": "true", "reason": "x"}' })],
  ['truncated', () => ({ ok: true, content: '{"matched": tr' })]
]

async function runBlock(block, cases, desc, entity, callAI, seen) {
  const events = []
  const helpers = { callAIUsing: callAI, sleep: async () => {}, log: () => {}, logRunEvent: async e => events.push(e),
    logRunEvents: async es => events.push(...es), element: async n => `//x[@n="${n}"]` }
  const posts = cases.map((c, i) => ({ index: i + 1, position: i + 1, content: c.content, authorUrl: `https://www.facebook.com/profile.php?id=${c.uid}`,
    postLink: `https://www.facebook.com/groups/1/posts/${c.uid}`, rawPostLink: '' }))
  const rows = cases.map(c => ({ postIndex: 1, content: c.content, authorUrl: `https://www.facebook.com/profile.php?id=${c.uid}`, authorName: 'N' + c.uid,
    commentUrl: `https://www.facebook.com/groups/1/posts/9?comment_id=${c.uid}` }))
  const page = { evaluate: async () => (COMMENTS.has(block.id)
    ? { rows, postCommentStats: [{ postIndex: 1, commentsCount: rows.length, opened: true, postUrl: 'https://www.facebook.com/groups/1/posts/9' }] }
    : { posts, count: posts.length }), scroll: async () => {} }
  const vars = { isFindInPost: true, isFindInComment: true, isFindUid: true, isFindPhone: false, isFindPostByContentAI: true, isFindCommentByContentAI: true,
    postContentAI: desc, commentContentAI: desc, findDataPosts: posts, findDataSearchPosts: posts, findDataSearchHasPost: true,
    postsPerTarget: cases.length, commentVariants: ['hi'], countCommentFindData: 1000, countPostFindData: 1000, countSearchPostFindData: 1000 }
  const ctx = { vars, input: { posts }, helpers, page, signal: new AbortController().signal, URL, console: { log() {}, warn() {}, error() {}, info() {} }, setTimeout, clearTimeout }
  let out, error = null
  try { out = await vm.runInNewContext(`(async()=>{${block.code}})()`, ctx) } catch (e) { error = String(e && e.message || e) }
  const selected = new Set()
  if (!error) {
    if (SEEDING.has(block.id)) for (const it of out.commentIterations || []) selected.add(Number(String(it.postUrl).split('/').pop()))
    else for (const u of (vars.findDataResults && vars.findDataResults.uids) || []) selected.add(Number(u))
  }
  return { selected, error, events }
}

// cases: [{ id, description, content, entity, label, ... }]; trả từng ca kèm quyết định AI, quyết định block, lỗi.
async function run(cases, { seed = 1, faultRate = 0, blocks = null, configs = null, chunk = 40 } = {}) {
  const r = rng(seed)
  const allIds = [...POST_BLOCKS, ...COMMENT_BLOCKS]
  const blockRows = blocks || await lib.loadBlocks(allIds)
  const cfg = configs || await lib.loadConfigs(['fb_prepare_seeding_iterations_ai_filter_v2', 'fb_extract_data_from_group_posts_ai_filter_v2', 'fb_collect_group_comments_ai_filter_v2',
    'fb_extract_data_from_search_posts_ai_filter_v2', 'fb_collect_search_post_comments_ai_filter_v2', FALLBACK])
  let pi = 0, ci = 0
  cases.forEach((c, i) => {
    c.uid = 9000000 + i
    c.block = c.entity === 'comment' ? COMMENT_BLOCKS[ci++ % COMMENT_BLOCKS.length] : POST_BLOCKS[pi++ % POST_BLOCKS.length]
  })
  const groups = new Map()
  for (const c of cases) {
    const k = `${c.block}\u0001${c.description}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(c)
  }
  const jobs = []
  for (const [k, list] of groups) for (let i = 0; i < list.length; i += chunk) jobs.push(list.slice(i, i + chunk))
  const results = []
  await Promise.all(jobs.map(async (list, job) => {
    const block = blockRows.find(b => b.id === list[0].block)
    const byText = new Map()
    for (const c of list) { byText.set(c.content, c); byText.set(String(c.content).trim(), c) }
    const calls = []
    const callAI = async (code, payload) => {
      const t = String(payload.contentText)
      const c = byText.get(t) || byText.get(t.trim()) || null
      let res, fault = null
      if (faultRate > 0 && r() < faultRate) { const f = FAULTS[Math.floor(r() * FAULTS.length)]; fault = f[0]; res = f[1]() }
      else if (!cfg[code]) res = { ok: false, error: `Không tìm thấy cấu hình AI: ${code}` }
      else res = await lib.callAiUsing(cfg[code], payload)
      calls.push({ case: c, code, fault, ok: res.ok, content: res.content, error: res.error, payload })
      return res
    }
    const { selected, error } = await runBlock(block, list, list[0].description, list[0].entity, callAI)
    for (const c of list) {
      const mine = calls.filter(x => x.case === c)
      const good = mine.filter(x => x.ok && (() => { const v = lib.parseVerdict(x.content); return v && (typeof v.matched === 'boolean' || typeof v.match === 'boolean') })())
      const last = good.at(-1)
      const v = last && lib.parseVerdict(last.content)
      results.push({ ...c, job, engine: ENGINE.has(block.id), blockError: error, calls: mine.map(x => ({ code: x.code, fault: x.fault, ok: x.ok, error: x.error && x.error.slice(0, 120) })),
        ai: v ? (v.matched === true || v.match === true) : null, aiReason: v ? String(v.reason || '').slice(0, 200) : null, aiExcluded: v ? v.excluded : null,
        aiCode: last ? last.code : null, selected: selected.has(c.uid), payloadOk: mine.every(x => x.payload.prompt === c.description && JSON.parse(x.payload.content) === x.payload.contentText) })
    }
  }))
  const unmapped = []
  return results
}
module.exports = { run, FAULTS, UNAVAILABLE, ENGINE }
