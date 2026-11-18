// Giả lập tuỳ chọn comment của "Đăng bài vào group" (18/11/2026): chạy CODE THẬT của các bản "[engine]" production (lấy link bài vừa đăng
// 2873, nhận chờ duyệt 2848 + hàm mở trang chờ duyệt của bộ lập lịch, bỏ qua nhóm đã biết cần duyệt 2875, chỉnh comment 2874, comment
// 2851 bản V563 đang chạy hoặc bản V568) trên trang Facebook giả trong Chromium, theo đúng thứ tự của workflow đăng nhóm 321 sau bước bấm
// Đăng, rồi đưa các bước cho BỘ DỰNG LỊCH SỬ THẬT (logMilestonesV2 của campaignScheduler.ts, chế độ thu lại) để in đúng dòng lịch sử và
// câu tiến trình khách thấy. Không chạm DB, không mở Facebook.
//
// Ma trận: 3 "Comment vào group nào" × 3 "Comment vào post nào" (tối đa 3) × các trường hợp sau khi bấm Đăng (đăng ngay có / không lấy được
// link, bài mình 2 ô, chờ duyệt thật, app ghi chờ duyệt vì còn bài chờ cũ, không kết luận được, bỏ qua đăng vì nhóm đã biết cần duyệt, trang
// ít bài, đăng thất bại). Trang giả: bấm ô bình luận thì mở hộp thoại bài đó (mặc định thay hộp thoại cũ; "stack" để hộp thoại cũ nằm lại),
// Enter thì ghi comment vào bài của ô nhập vừa gõ (thế giới ghi lại comment thật rơi vào bài nào).
//
// Chạy: CHROMIUM_PATH=<Chrome> node scripts/engine-v2-facebook/comment-options-sim.cjs [--out <thư mục>]
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { loadScheduler } = require('./desktop-harness.cjs')
const B = require('../build-v563-sql.cjs')
const C = require('../build-v568-sql.cjs')

const ROOT = path.resolve(__dirname, '../..')
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/comment-sim-20261118.json'), 'utf8'))
const OUT_DIR = (() => { const i = process.argv.indexOf('--out'); return i > 0 ? process.argv[i + 1] : fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-comment-sim-')) })()
const GROUP = 'https://www.facebook.com/groups/123/'
const ID = { own: '777000111', A: '111000444', B: '222000555', C: '333000666' }
const NAME_OF = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, k === 'own' ? 'bài mình' : k]))
const N = 3
const VERSIONS = { V563: B.COMMENT.newCode, V568: C.NEW_CODE }

// ------------------------------------------------------------------------------------------------ trang Facebook giả
const PAGE_SCRIPT = `<script>
window.__aka = { comments: [], seq: 0 };
function __akaOpenDialog(postId) {
  if (!window.__akaStack) document.querySelectorAll('[role=dialog]').forEach(d => d.remove());
  const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.setAttribute('data-post-id', postId);
  d.innerHTML = '<a href="/groups/123/posts/' + postId + '/">Bài viết</a><div class="comments"></div>'
    + '<div role="textbox" aria-label="Viết bình luận..." contenteditable="true"></div>';
  document.body.appendChild(d);
}
document.addEventListener('click', e => {
  const box = e.target.closest('[data-box]'); if (!box || box.closest('[role=dialog]')) return;
  const post = box.closest('[data-post]'); if (post) __akaOpenDialog(post.getAttribute('data-post'));
}, true);
window.__akaEnter = () => {
  const el = window.__akaTyping; if (!el || !el.isConnected) return false;
  const d = el.closest('[role=dialog]'); const id = d ? d.getAttribute('data-post-id') : null;
  const n = ++window.__aka.seq;
  window.__aka.comments.push({ post: id, text: el.textContent.trim() });
  if (d) d.querySelector('.comments').insertAdjacentHTML('beforeend', '<div role="article"><span class="xt0psk2">Tài khoản thử</span>'
    + '<a href="/groups/123/posts/' + id + '/?comment_id=' + (1000 + n) + '">Vừa xong</a></div>');
  el.textContent = '';
  return true;
};
</script>`
const post = (id, { boxes = 1, pendingLink = false, commentable = true } = {}) => `<div class="post" data-post="${id}">
  <a href="/groups/123/user/${id}/">${NAME_OF[id]}</a> ▶ <a target="_blank" href="/groups/123/?__cft__[0]=g">Nhóm thử</a>
  <a href="/groups/123/${pendingLink ? 'pending_posts' : 'posts'}/${id}/?__cft__[0]=t">Vừa xong</a><p>Nội dung ${NAME_OF[id]}</p>
  ${commentable ? `<div role="button" data-box aria-label="Bình luận về bài viết của ${NAME_OF[id]}">Bình luận</div>` : '<div>Đang chờ phê duyệt</div>'}
  ${commentable && boxes > 1 ? '<div data-box aria-label="Viết bình luận..."></div>' : ''}</div>`
function wallHtml(cs) {
  const own = cs.own === 'published' ? post(ID.own, { boxes: cs.ownBoxes || 1 })
    : cs.own === 'pending' ? post(ID.own, { pendingLink: true, commentable: false })
      : cs.own === 'processing' ? '<div>Bài viết của bạn đang được xử lý.</div>' : ''
  return `<!doctype html><html><head><meta charset="utf-8">${PAGE_SCRIPT}</head><body><div role="main"><h1>Nhóm thử</h1>
    <div class="new-post">${own}</div>
    <div role="feed">${(cs.feed || ['A', 'B', 'C']).map(k => post(ID[k])).join('')}</div></div></body></html>`
}
// Trang my_pending_content: bài chờ cũ có khung xem trước link (href tương đối ?__cft__…, đọc trên trang thật 18/11).
const PENDING_EMPTY = '<!doctype html><html><head><meta charset="utf-8"></head><body><div role="main">Không có nội dung nào đang chờ.</div></body></html>'
const PENDING_OLD = `<!doctype html><html><head><meta charset="utf-8"></head><body><div role="main"><div>Đang chờ · 1</div>
  <div class="pending-post">Tài khoản thử đã đăng lên Nhóm thử · 01/07/2026 <a target="_blank" href="?__cft__[0]=p">shop.example.com — Ảnh từ bài viết</a></div>
  </div></body></html>`

const CASES = [
  { key: 'pub_link', label: 'Đăng ngay, lấy được link bài', own: 'published', pending: 'empty' },
  { key: 'pub_nolink', label: 'Đăng ngay, bài chưa hiện nên không lấy được link (bài video)', own: 'processing', pending: 'empty' },
  { key: 'pub_twobox', label: 'Đăng ngay, bài mình có 2 ô bình luận', own: 'published', ownBoxes: 2, pending: 'empty' },
  { key: 'pending_true', label: 'Chờ duyệt thật (link /pending_posts/)', own: 'pending', pending: 'empty' },
  { key: 'pending_flagged', label: 'Bài đã lên nhưng app ghi chờ duyệt (trang chờ duyệt còn bài cũ)', own: 'published', pending: 'old' },
  { key: 'pending_unknown', label: 'Không mở được trang chờ duyệt (không kết luận được)', own: 'published', pending: 'fail' },
  { key: 'skip_known', label: 'Bỏ qua đăng vì nhóm đã biết cần duyệt', own: 'none', pending: 'empty', skipKnown: true },
  { key: 'few_posts', label: 'Đăng ngay, trên trang chỉ có 2 bài khác', own: 'published', feed: ['A', 'B'], pending: 'empty' },
  { key: 'post_failed', label: 'Đăng thất bại (form không đóng)', own: 'none', pending: 'empty', postFails: true }
]
const COMBOS = []
for (const gm of ['all', 'pending_only', 'published_only']) for (const ct of ['own', 'others', 'all']) COMBOS.push({ gm, ct })
const GM_LABEL = { all: 'mọi group', pending_only: 'chỉ group bị duyệt', published_only: 'chỉ group đăng thành công ngay' }
const CT_LABEL = { own: 'post của mình', others: 'không comment post của mình', all: 'comment tất cả' }

// ------------------------------------------------------------------------------------------------ chạy code block
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
function adapter(pw) {
  const evalIn = (script, args) => pw.evaluate(({ script, args }) => {
    const F = Object.getPrototypeOf(async function () {}).constructor
    return new F('__args', script)(args)
  }, { script, args })
  return {
    async navigate(url) { await pw.goto(url, { waitUntil: 'domcontentloaded' }) },
    evaluate: (script, ...args) => evalIn(script, args),
    async waitForSelector(xpath) {
      const ok = await pw.evaluate(x => !!document.evaluate(x, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue, xpath)
      if (!ok) throw new Error('waitForSelector timeout: ' + xpath)
    },
    async click(xpath) {
      const ok = await pw.evaluate(x => { const el = document.evaluate(x, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; if (el) el.click(); return !!el }, xpath)
      if (!ok) throw new Error('waitForSelector timeout: ' + xpath)
    },
    async fill(xpath, text) {
      await pw.evaluate(({ x, text }) => { const el = document.evaluate(x, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
        if (el) { el.textContent = text; window.__akaTyping = el } }, { x: xpath, text })
    },
    async type(xpath, text) {
      await pw.evaluate(({ x, text }) => { const el = document.evaluate(x, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
        if (el) { el.textContent += text; window.__akaTyping = el } }, { x: xpath, text })
    },
    async press(key) { if (key === 'Enter') await pw.evaluate(() => window.__akaEnter()) },
    async dropFile() { return { fileCount: 0 } },
    url: () => pw.url()
  }
}
function helpersFor(extra = {}) {
  return {
    async element(name) { const x = FIX.elements[name]; if (!x) throw new Error('Thiếu phần tử ' + name); return x },
    async elementWith(name, values) { return FIX.elements[name].replace('${n}', String(values.n)) },
    async sleep() {}, log(message) { (extra.logs || []).push(String(message)) }, ...extra
  }
}
async function runBlock(code, { page, vars, input = {}, helpers }) {
  const sandbox = vm.createContext({ input, page, vars, helpers, signal: { aborted: false }, console, setTimeout, clearTimeout, Promise, JSON, Math,
    Date, RegExp, Array, Object, String, Number, Boolean, Map, Set, Symbol, Error, URL })
  const out = await vm.runInContext(`(async () => {\n${code}\n})()`, sandbox)
  return out && typeof out === 'object' ? JSON.parse(JSON.stringify(out)) : out
}

async function main() {
  const { mod } = await loadScheduler({ replayExecutor: true })
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-comment-sim-ud-'))
  const noop = new Proxy({}, { get: (_t, key) => key === 'then' ? undefined : (async () => null) })
  globalThis.__fbHarness = { userData, client: noop, user: { staffId: 1, organizationId: 1, facebookEngineV2: true }, runs: [], runSteps: [],
    workflows: new Map(), block: () => null }
  const scheduler = new mod.CampaignScheduler(noop, { isRegistered: () => true, listRegistered: () => [], getWebContentsId: () => null },
    { webContents: { send() {} }, isDestroyed: () => false }, undefined, undefined, undefined, { runtimeTarget: 'desktop' })
  const captured = { rows: [], lines: [] }
  Object.assign(scheduler, {
    writeCampaignDetail: async action => { captured.rows.push(action); return { ...action, id: captured.rows.length } },
    logCampaignProgress: async (_campaign, message) => { captured.lines.push(String(message)) },
    syncGroupPostContactStatus: async () => {}, enqueuePostBumpAfterGroupPost: async () => {},
    sendBackgroundPreviewSnapshot: async () => {}, startBackgroundPreview() {}, stopBackgroundPreview() {}
  })

  const { chromium } = require('playwright')
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {})
  const context = await browser.newContext()
  let routeState = null
  await context.route('https://www.facebook.com/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/groups/123/my_pending_content')) {
      if (routeState.pending === 'fail') return route.abort('connectionrefused')
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: routeState.pending === 'old' ? PENDING_OLD : PENDING_EMPTY })
    }
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: wallHtml(routeState) })
  })
  const ACCOUNT = { id: 1, flatformType: 'facebook' }
  scheduler.backgroundPages = {
    createTemporary() {
      let pw = null
      const lazy = new Proxy({}, { get: (_t, key) => async (...args) => { pw = pw || await context.newPage(); return adapter(pw)[key](...args) } })
      return { page: lazy, destroy() { if (pw) pw.close().catch(() => {}) } }
    },
    getOrCreate() { throw new Error('không dùng') }, destroy() {}, destroyAll() {}
  }

  // Phần chung theo trường hợp: các bước trước vòng comment (không phụ thuộc tuỳ chọn) chạy một lần.
  const prefixCache = new Map()
  async function prefix(cs, combo, campaign) {
    const vars = { enableComment: true, commentType: combo.ct, commentGroupMode: combo.gm, commentCount: N, images: [],
      commentIterations: (combo.ct === 'own' ? [1] : combo.ct === 'all' ? [1, 2, 3] : [2, 3, 4]).map((position, k) => ({ position, text: `Nội dung comment ${k + 1}`, images: [] })),
      targetUrl: GROUP, inputDataUid: GROUP, skipGroupPostByKnownApproval: !!cs.skipKnown, groupPostRequiresPostApproval: cs.skipKnown ? true : null,
      groupPostApprovalSource: cs.skipKnown ? 'account_contact' : '' }
    if (!prefixCache.has(cs.key)) {
      const pw = await context.newPage(); routeState = cs
      await pw.goto(GROUP, { waitUntil: 'domcontentloaded' })
      const page = adapter(pw), steps = [], probe = { ...vars }
      if (cs.skipKnown) {
        steps.push({ blockName: 'fb_skip_group_post_for_known_approval', nodeId: 'skip_known_approval', status: 'success',
          output: await runBlock(FIX.blocks.skip.code, { page, vars: probe, helpers: helpersFor() }) })
      } else if (cs.postFails) {
        probe.groupPostSubmitted = false
        steps.push({ blockName: 'fb_verify_group_post_form_closed', nodeId: 'verify_submit', status: 'success',
          output: { ok: false, posted: false, submitClosed: false, message: 'Form đăng bài chưa đóng sau 60 giây' } })
      } else {
        probe.groupPostSubmitted = true
        steps.push({ blockName: 'fb_verify_group_post_form_closed', nodeId: 'verify_submit', status: 'success', output: { ok: true, posted: true, submitClosed: true } })
        steps.push({ blockName: 'fb_get_first_group_post_link', nodeId: 'get_post_link', status: 'success',
          output: await runBlock(FIX.blocks.link.code, { page, vars: probe, helpers: helpersFor() }) })
      }
      if (!cs.postFails) {
        const helpers = helpersFor({ checkGroupPendingContent: options => scheduler.checkGroupPendingContent(ACCOUNT, campaign, page, options) })
        steps.push({ blockName: 'fb_detect_pending_post', nodeId: 'detect_pending', status: 'success', output: await runBlock(FIX.blocks.detect.code, { page, vars: probe, helpers }) })
      }
      await pw.close()
      const keep = ['groupPostSubmitted', 'groupPostSkippedByKnownApproval', 'groupPostIsPending', 'groupPostPostUrl', 'groupPostRawPostLink']
      prefixCache.set(cs.key, { steps, state: Object.fromEntries(keep.filter(k => k in probe).map(k => [k, probe[k]])) })
    }
    const cached = prefixCache.get(cs.key)
    return { vars: { ...vars, ...cached.state }, steps: cached.steps.map(s => ({ ...s, output: JSON.parse(JSON.stringify(s.output)) })) }
  }

  async function runScenario(cs, combo, version, { stack = false } = {}) {
    const campaign = { id: 1, name: 'Chiến dịch thử', actionId: 'facebook_group_post', extraSettings: { enableComment: true, commentType: combo.ct,
      commentGroupMode: combo.gm, commentCount: N, skipPostIfGroupRequiresApproval: !!cs.skipKnown } }
    const detail = { id: 10, campaignId: 1, uid: GROUP, name: 'Nhóm thử', status: 'đang chạy' }
    const { vars, steps } = await prefix(cs, combo, campaign)
    const pw = await context.newPage(); routeState = cs
    await pw.addInitScript(s => { window.__akaStack = s }, stack)
    await pw.goto(GROUP, { waitUntil: 'domcontentloaded' })
    const page = adapter(pw)
    if (!cs.postFails) {
      steps.push({ blockName: 'fb_adjust_group_post_comments_after_pending', nodeId: 'adjust_comments_after_pending', status: 'success',
        output: await runBlock(B.ADJUST.newCode, { page, vars, helpers: helpersFor() }) })
      if (vars.enableComment === true && Array.isArray(vars.commentIterations) && vars.commentIterations.length > 0) {
        const items = [...vars.commentIterations]
        for (let i = 0; i < items.length; i++) {
          vars.loopItem = items[i]; vars.loopIndex = i
          const logs = []
          try {
            steps.push({ blockName: 'fb_comment_at_position', nodeId: 'comment', status: 'success', logs,
              output: await runBlock(VERSIONS[version], { page, vars, helpers: helpersFor({ logs }) }) })
          } catch (error) {
            steps.push({ blockName: 'fb_comment_at_position', nodeId: 'comment', status: 'error', error: error.message, output: null, logs })
            break
          }
        }
      }
    }
    const world = await pw.evaluate(() => window.__aka.comments)
    await pw.close()
    captured.rows = []; captured.lines = []
    if (cs.skipKnown) captured.lines.push('⚠️ Bỏ qua đăng bài vào "Nhóm thử" vì group đã biết cần duyệt bài')
    await scheduler.logMilestonesV2(campaign, detail, ACCOUNT.id, steps.map((s, i) => ({ id: i + 1, startedAt: `t${i}`, ...s })), true)
    return { world, rows: captured.rows.map(r => ({ status: r.status, actionName: r.actionName, log: r.log })), lines: [...captured.lines], steps }
  }

  const results = []
  const describe = world => world.map(c => NAME_OF[c.post] || c.post)
  const flagsOf = (cs, combo, r) => {
    const flags = []
    const targets = r.world.map(c => c.post)
    const counts = targets.reduce((m, p) => m.set(p, (m.get(p) || 0) + 1), new Map())
    for (const [p, n] of counts) if (n > 1) flags.push(`comment ${n} lần vào ${NAME_OF[p] || p}`)
    if (combo.ct === 'others' && targets.includes(ID.own)) flags.push('comment vào bài mình dù chọn không comment bài mình')
    const commentRows = r.rows.filter(x => x.actionName === 'Comment' && x.status === 'thành công')
    commentRows.forEach((row, i) => {
      const actual = targets[i]
      if (/bài của mình/.test(row.log) && actual !== ID.own) flags.push(`dòng "${row.log.slice(0, 40)}…" nhưng comment rơi vào ${NAME_OF[actual] || actual}`)
      if (!/bài của mình/.test(row.log) && actual === ID.own) flags.push(`comment vào bài mình nhưng dòng ghi "${row.log.slice(0, 40)}…"`)
    })
    return flags
  }
  try {
    for (const cs of CASES) {
      for (const combo of COMBOS) {
        const row = { case: cs.key, caseLabel: cs.label, gm: combo.gm, ct: combo.ct }
        for (const version of Object.keys(VERSIONS)) {
          const r = await runScenario(cs, combo, version)
          row[version] = { comments: describe(r.world), flags: flagsOf(cs, combo, r), rows: r.rows, lines: r.lines }
        }
        results.push(row)
      }
    }
    // Hộp thoại cũ nằm lại (chưa biết Facebook có làm vậy không): cả hai bản gõ vào ô nhập của hộp thoại đầu tiên.
    const stackCases = []
    for (const combo of [{ gm: 'all', ct: 'others' }, { gm: 'all', ct: 'all' }]) {
      const cs = CASES[0], row = { case: 'stack_' + cs.key, caseLabel: 'Giả định: hộp thoại bài trước còn mở khi bấm ô kế (' + cs.label + ')', gm: combo.gm, ct: combo.ct }
      for (const version of Object.keys(VERSIONS)) {
        const r = await runScenario(cs, combo, version, { stack: true })
        row[version] = { comments: describe(r.world), flags: flagsOf(cs, combo, r), rows: r.rows, lines: r.lines }
      }
      stackCases.push(row)
    }
    fs.mkdirSync(OUT_DIR, { recursive: true })
    fs.writeFileSync(path.join(OUT_DIR, 'comment-options-sim.json'), JSON.stringify({ results, stackCases }, null, 1))
    fs.writeFileSync(path.join(OUT_DIR, 'comment-options-sim.md'), report(results, stackCases))
    const bad = v => results.filter(r => r[v].flags.length).length
    console.log(`Xong ${results.length} tổ hợp × 2 bản. Có vấn đề: V563 ${bad('V563')}, V568 ${bad('V568')}. Báo cáo: ${path.join(OUT_DIR, 'comment-options-sim.md')}`)
  } finally {
    await browser.close()
  }
}

function report(results, stackCases) {
  const cell = side => (side.comments.length ? side.comments.join(', ') : 'không comment') + (side.flags.length ? ` ❌ ${side.flags.join('; ')}` : '')
  const customer = side => [...side.lines.filter(l => /^(💬|⚠️|⏳|✅|📝|❌)/.test(l))].join(' · ')
  let md = '# Giả lập tuỳ chọn comment khi đăng nhóm (code block thật, trang Facebook giả)\n\n'
  md += 'Mỗi ô: comment thật rơi vào bài nào (A, B, C là bài người khác theo thứ tự trên trang). ❌ = có vấn đề. Cột cuối: câu tiến trình khách thấy với bản V568.\n\n'
  for (const cs of [...new Set(results.map(r => r.case))]) {
    const rows = results.filter(r => r.case === cs)
    md += `## ${rows[0].caseLabel}\n\n| Group nào | Post nào | V563 (đang chạy) | V568 | Khách thấy (V568) |\n|---|---|---|---|---|\n`
    for (const r of rows) md += `| ${GM_LABEL[r.gm]} | ${CT_LABEL[r.ct]} | ${cell(r.V563)} | ${cell(r.V568)} | ${customer(r.V568)} |\n`
    md += '\n'
  }
  md += '## Giả định: hộp thoại bài trước còn mở\n\n| Post nào | V563 | V568 |\n|---|---|---|\n'
  for (const r of stackCases) md += `| ${CT_LABEL[r.ct]} | ${cell(r.V563)} | ${cell(r.V568)} |\n`
  return md
}

main().catch(error => { console.error(error); process.exit(1) })
