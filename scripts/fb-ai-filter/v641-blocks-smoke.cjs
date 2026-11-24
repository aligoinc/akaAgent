#!/usr/bin/env node
// Bài kiểm V641: chạy code thật của 10 block lọc AI sau khi sửa (scripts/fixtures/fb-ai-filter/blocks-v641.json) trong Node vm với
// helpers / page giả. Không gọi AI thật, không mở Facebook.
//   node scripts/fb-ai-filter/v641-blocks-smoke.cjs
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')

const ROOT = path.resolve(__dirname, '../..')
const V641 = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/fb-ai-filter/blocks-v641.json'), 'utf8')).blocks
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/fb-ai-filter/blocks-live-20261124.json'), 'utf8')).blocks
const UNAVAILABLE = 'AI lọc bài tạm thời không dùng được'
let checks = 0
const ok = (cond, msg) => { assert.ok(cond, msg); checks++ }

const answer = matched => ({ ok: true, content: JSON.stringify({ matched, excluded: !matched, reason: 'r' }) })
// script: mỗi mã cấu hình một danh sách câu trả lời theo thứ tự gọi (hết danh sách thì lặp phần tử cuối).
function fakeHelpers(script) {
  const calls = []
  const sleeps = []
  const helpers = {
    calls, sleeps,
    callAIUsing: async (code, payload) => {
      calls.push({ code, payload })
      const list = script[code] || [{ ok: false, error: `Không tìm thấy cấu hình AI: ${code}` }]
      const n = calls.filter(c => c.code === code).length - 1
      const item = list[Math.min(n, list.length - 1)]
      return typeof item === 'function' ? item(payload) : item
    },
    sleep: async (ms) => { sleeps.push(ms) },
    log: () => {},
    logRunEvent: async () => {},
    logRunEvents: async () => {},
    element: async name => `//fake[@name="${name}"]`
  }
  return helpers
}
const run = (code, ctx) => vm.runInNewContext(`(async()=>{${code}})()`, { ...ctx, URL, console, setTimeout, clearTimeout })

// Phần đầu block (đến hết hàm gọi AI) để thử riêng __aiFilterCall ở mọi block.
function aiCallOf(block, helpers, signal) {
  const code = block.code
  const end = code.indexOf('async function checkMeaningAi') >= 0 && block.kind === 'seeding'
    ? code.indexOf('async function checkMeaningAi')
    : code.indexOf('const __splitMeaningTraits')
  assert.ok(end > 0, `không tách được phần đầu block ${block.id}`)
  const prefix = code.slice(0, end)
  return vm.runInNewContext(`${prefix}\n;(code, payload) => __aiFilterCall(code, payload)`, { helpers, signal, console, input: {}, vars: {} })
}

async function unitTests() {
  for (const block of V641) {
    const main = block.kind === 'seeding' ? 'fb_prepare_seeding_iterations_ai_filter_v2' : block.code.match(/const __aiFindDataUsingCode = "([^"]+)"/)[1]
    ok(main.endsWith('_v2'), `${block.id}: gọi mã _v2`)
    // 1. Thành công ngay
    let h = fakeHelpers({ [main]: [answer(true)] })
    let r = await aiCallOf(block, h)(main, { prompt: 'x' })
    ok(r.ok === true && h.calls.length === 1 && h.sleeps.length === 0, `${block.id}: một lượt khi thành công`)
    // 2. Lỗi tạm 2 lần rồi được
    h = fakeHelpers({ [main]: [{ ok: false, error: 'AI trả về lỗi 503' }, { ok: false, error: 'fetch failed' }, answer(false)] })
    r = await aiCallOf(block, h)(main, {})
    ok(r.ok === true && h.calls.length === 3 && h.calls.every(c => c.code === main), `${block.id}: thử lại 2 lần`)
    ok(JSON.stringify(h.sleeps) === '[2000,5000]', `${block.id}: nghỉ 2 giây rồi 5 giây`)
    // 3. Hết tiền: sang dự phòng ngay
    h = fakeHelpers({ [main]: [{ ok: false, error: 'AI trả về lỗi 402: Insufficient Balance' }], fb_ai_content_filter_fallback: [answer(true)] })
    r = await aiCallOf(block, h)(main, {})
    ok(r.ok === true && h.calls.map(c => c.code).join() === `${main},fb_ai_content_filter_fallback`, `${block.id}: 402 sang dự phòng ngay`)
    // 4. Trả lời sai khuôn tính là lỗi
    h = fakeHelpers({ [main]: [{ ok: true, content: 'Có, bài này phù hợp' }], fb_ai_content_filter_fallback: [answer(false)] })
    r = await aiCallOf(block, h)(main, {})
    ok(r.ok === true && h.calls.filter(c => c.code === main).length === 3 && h.calls.at(-1).code === 'fb_ai_content_filter_fallback', `${block.id}: sai khuôn thì thử lại rồi dự phòng`)
    // 5. Cả hai đều lỗi
    h = fakeHelpers({ [main]: [{ ok: false, error: 'AI trả về lỗi 500' }], fb_ai_content_filter_fallback: [{ ok: false, error: 'AI trả về lỗi 429' }] })
    if (block.variant === 'engine') {
      await assert.rejects(aiCallOf(block, h)(main, {}), e => String(e.message).startsWith(UNAVAILABLE) && /429/.test(e.message))
      checks++
    } else {
      r = await aiCallOf(block, h)(main, {})
      ok(r.ok === false && /429/.test(r.error), `${block.id}: bộ cũ trả lỗi như trước`)
    }
    ok(h.calls.length === 5, `${block.id}: 3 lượt chính + 2 lượt dự phòng`)
    // 6. Runtime chưa hỗ trợ callAIUsing: giữ như trước
    h = fakeHelpers({})
    h.callAIUsing = async () => ({ unsupported: true })
    r = await aiCallOf(block, h)(main, {})
    ok(r && r.unsupported === true, `${block.id}: runtime cũ`)
  }
}

// Chạy nguyên block tìm data bài viết (bài lấy từ vars / input, không cần trang).
async function findPostBlockTests() {
  for (const id of [2602, 2863, 2718, 2904]) {
    const block = V641.find(b => b.id === id)
    const main = block.code.match(/const __aiFindDataUsingCode = "([^"]+)"/)[1]
    const posts = [
      { index: 1, content: 'Mình cần thuê phòng trọ gần Cầu Giấy, liên hệ 0912345678', authorUrl: 'https://www.facebook.com/profile.php?id=1001', postLink: 'https://www.facebook.com/groups/1/posts/11' },
      { index: 2, content: 'Cho thuê phòng full đồ 3tr, gọi 0987654321', authorUrl: 'https://www.facebook.com/profile.php?id=1002', postLink: 'https://www.facebook.com/groups/1/posts/12' }
    ]
    const vars = { isFindInPost: true, isFindPhone: true, isFindUid: true, isFindPostByContentAI: true,
      postContentAI: 'Người cần thuê phòng trọ\nLoại bỏ: bài cho thuê của chủ nhà hoặc môi giới', findDataPosts: posts, findDataSearchPosts: posts, findDataSearchHasPost: true }
    const byContent = payload => answer(/cần thuê/.test(String(payload.contentText)))
    let h = fakeHelpers({ [main]: [byContent] })
    const out = await run(block.code, { vars: { ...vars }, input: { posts }, helpers: h, page: {}, signal: new AbortController().signal })
    ok(h.calls.length === 2 && h.calls.every(c => c.code === main && c.payload.prompt === vars.postContentAI), `${id}: gửi nguyên văn mô tả, gọi mã _v2`)
    const text = JSON.stringify(out)
    ok(text.includes('0912345678') && !text.includes('0987654321'), `${id}: chỉ lấy data của bài khớp`)
    // Cả hai mô hình lỗi
    h = fakeHelpers({ [main]: [{ ok: false, error: 'AI trả về lỗi 503' }], fb_ai_content_filter_fallback: [{ ok: false, error: 'fetch failed' }] })
    await assert.rejects(run(block.code, { vars: { ...vars }, input: { posts }, helpers: h, page: {}, signal: new AbortController().signal }),
      e => block.variant === 'engine' ? String(e.message).startsWith(UNAVAILABLE) : String(e.message) === 'fetch failed')
    checks++
  }
}

// Chạy nguyên block chọn bài Comment seeding với trang giả (page.evaluate trả danh sách bài như đoạn đọc DOM).
async function seedingBlockTests() {
  for (const id of [2554, 2859]) {
    const block = V641.find(b => b.id === id)
    const posts = [
      { position: 1, content: 'Em cần tìm phòng trọ khu Hoàng Mai giá 3 triệu', rawPostLink: '', postLink: 'https://www.facebook.com/groups/1/posts/21' },
      { position: 2, content: 'Cho thuê phòng đẹp, inbox em', rawPostLink: '', postLink: 'https://www.facebook.com/groups/1/posts/22' },
      { position: 3, content: 'Ai cần thuê phòng gần trường thì ib, mình là sinh viên cần ở ghép', rawPostLink: '', postLink: 'https://www.facebook.com/groups/1/posts/23' }
    ]
    const page = { evaluate: async (code) => (String(code).includes('__args[0]') ? { posts, count: posts.length } : null), scroll: async () => {} }
    const vars = { isFindPostByContentAI: true, postContentAI: 'người đăng cần tìm phòng trọ', postsPerTarget: 2, commentVariants: ['Xin chào'] }
    const byContent = payload => answer(/cần (tìm|thuê) phòng/.test(String(payload.contentText)) && !/^Cho thuê/.test(String(payload.contentText)))
    let h = fakeHelpers({ fb_prepare_seeding_iterations_ai_filter_v2: [byContent] })
    const out = await run(block.code, { vars: { ...vars }, input: {}, helpers: h, page, signal: new AbortController().signal })
    ok(out.commentIterations.length === 2 && out.commentIterations.map(i => i.position).join() === '1,3', `${id}: chọn bài 1 và 3`)
    ok(h.calls.every(c => c.code === 'fb_prepare_seeding_iterations_ai_filter_v2' && c.payload.prompt === vars.postContentAI), `${id}: mã _v2, nguyên văn mô tả`)
    // Cả hai mô hình lỗi
    h = fakeHelpers({ fb_prepare_seeding_iterations_ai_filter_v2: [{ ok: false, error: 'AI trả về lỗi 402' }], fb_ai_content_filter_fallback: [{ ok: false, error: 'AI trả về lỗi 500' }] })
    if (block.variant === 'engine') {
      await assert.rejects(run(block.code, { vars: { ...vars }, input: {}, helpers: h, page, signal: new AbortController().signal }),
        e => String(e.message).startsWith(UNAVAILABLE))
      checks++
    } else {
      const res = await run(block.code, { vars: { ...vars }, input: {}, helpers: h, page, signal: new AbortController().signal })
      ok(res.commentIterations.length === 0, `${id}: bộ cũ bỏ bài như trước khi AI lỗi`)
    }
  }
}

// Code ngoài phần sửa không đổi: bỏ phần thêm vào thì về đúng bản đang chạy.
function diffTests() {
  for (const block of V641) {
    const live = LIVE.find(b => b.id === block.id)
    ok(block.code.length > live.code.length && block.code.includes('__aiFilterCall('), `${block.id}: có hàm gọi mới`)
    ok(!live.code.includes('_ai_filter_v2'), `${block.id}: bản đang chạy chưa gọi _v2`)
  }
}

;(async () => {
  diffTests()
  await unitTests()
  await findPostBlockTests()
  await seedingBlockTests()
  console.log(`v641-blocks-smoke: ${checks} kiểm đạt`)
})().catch(error => { console.error(error); process.exit(1) })
