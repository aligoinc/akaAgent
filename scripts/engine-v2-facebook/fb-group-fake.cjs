// Trang nhóm Facebook giả cho bài kiểm block comment của engine v2 (V572, 18/11/2026). Làm theo các hành vi đo trên Facebook thật 18/11
// (trình duyệt thử, "Nhóm private 1"), vì bài kiểm V568 dùng trang giả có link bài đầy đủ nên không bắt được lỗi trên trang thật:
//   - feed chưa nạp link bài: link mốc thời gian là "?__cft__[0]=…", focusin mới nạp /groups/<g>/posts/<id>/ (block lấy link 2873 làm vậy với
//     bài vừa đăng); bài có comment thì có link comment chứa mã bài; ô bình luận: div[role=button][aria-label="Bình luận về bài viết của <tác giả>"];
//   - bấm ô khi trang đã mở đủ lâu: link đổi ngay trong cú bấm (pushState) sang /groups/<g>/permalink/<id>/ và mở hộp thoại; hộp thoại đang mở
//     thì nội dung đổi sau một lúc (ô nhập giữ nguyên khi cùng người đăng, tạo mới khi khác người đăng; mã __cft__ trong link đổi theo bài);
//     bấm ô của chính bài đang mở thì không đổi gì;
//   - trong hộp thoại có nút "Bình luận về bài viết của <tác giả>" (khớp phần tử fb_comment_box_at_n) và ô nhập "Bình luận dưới tên …";
//   - hộp thoại mở thì trang nền bị khoá cuộn; Escape đóng hộp thoại, link về trang nhóm;
//   - feed nạp dần: lúc đầu vài bài, cuộn thì nạp thêm, bài trôi xa phía trên bị gỡ khỏi trang;
//   - bấm ô khi trang vừa tải (chưa tới readyMs) thì chuyển hẳn sang trang riêng của bài (/groups/<g>/permalink/<id>), phía sau là trang chủ có
//     bài ngoài nhóm;
//   - Enter trong ô nhập: ghi comment vào bài mà ô nhập đang thuộc về (data-post-id lúc đó), như Facebook gửi comment của hộp thoại đang hiện.
// Đồng hồ ảo: performance.now() của trang cộng thêm thời gian helpers.sleep của block (bài kiểm không phải chờ thật 25 giây).
'use strict'

const GROUP = '123'
const BASE = 'https://www.facebook.com'

/** Kịch bản bài trên trang: { id, author, comments } (comments > 0: có link comment chứa mã bài, như bài đã có người comment). */
function pageScript(cfg) {
  return `<script>
(() => {
  const CFG = ${JSON.stringify(cfg)};
  const realNow = performance.now.bind(performance);
  window.__akaClock = 0;
  performance.now = () => realNow() + window.__akaClock;
  const byId = Object.fromEntries(CFG.posts.concat(CFG.own ? [CFG.own] : []).concat(CFG.featured || []).concat([CFG.foreign]).map(p => [p.id, p]));
  const token = id => 'TOK' + id;
  const record = rec => { try { window.__akaRecordComment(rec) } catch (e) {} };
  function postHtml(p, { area = 'feed', hidden = false } = {}) {
    const real = (p.foreign ? '/' + p.page + '/posts/' : '/groups/${GROUP}/posts/') + p.id + '/?__cft__[0]=' + token(p.id);
    const ts = CFG.ownLinkLoaded && CFG.own && p.id === CFG.own.id ? real : '?__cft__[0]=' + token(p.id);
    let comments = '';
    for (let i = 0; i < (p.comments || 0); i++) comments += '<div role="article"><a href="/groups/${GROUP}/posts/' + p.id + '/?comment_id=' + (500 + i) + '&__cft__[0]=' + token(p.id) + '">Bình luận cũ</a></div>';
    return '<div class="post" data-post="' + p.id + '" data-area="' + area + '" style="min-height:420px;' + (hidden ? 'display:none;' : '') + '">'
      + '<h3><a href="/groups/${GROUP}/user/' + p.id + '/?__cft__[0]=' + token(p.id) + '">' + p.author + '</a></h3>'
      + '<a class="ts" href="' + ts + '" data-real="' + real + '">5 giờ</a><p>Nội dung ' + p.id + '</p>' + comments
      + '<div role="button" tabindex="0" aria-label="Bình luận về bài viết của ' + p.author + '">Bình luận</div></div>';
  }
  function dialogInner(p) {
    return '<h2>Bài viết của ' + p.author + '</h2><a class="grp" href="/groups/${GROUP}/?__cft__[0]=' + token(p.id) + '">Nhóm thử</a>'
      + '<p class="body">Nội dung ' + p.id + '</p><div class="clist"></div>'
      + '<div role="button" tabindex="0" aria-label="Bình luận về bài viết của ' + p.author + '">Bình luận</div>';
  }
  function makeInput(p) {
    const input = document.createElement('div');
    input.setAttribute('role', 'textbox'); input.setAttribute('contenteditable', 'true');
    input.setAttribute('aria-label', 'Bình luận dưới tên Tài khoản thử'); input.setAttribute('data-post-id', p.id);
    input.style.minHeight = '20px';
    return input;
  }
  let dialog = null, frozen = null, shownId = null, swapTimer = null;
  function freeze() {
    if (frozen) return;
    const main = document.querySelector('[role=main]');
    frozen = { y: window.scrollY };
    main.style.position = 'fixed'; main.style.top = (-frozen.y) + 'px'; main.style.width = '100%';
  }
  function unfreeze() {
    if (!frozen) return;
    const main = document.querySelector('[role=main]');
    main.style.position = ''; main.style.top = ''; const y = frozen.y; frozen = null; window.scrollTo(0, y);
  }
  function openDialog(id) {
    const p = byId[id];
    dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
    dialog.style.cssText = 'position:fixed;left:10%;top:5%;width:80%;height:90%;background:#fff;overflow:auto;z-index:10';
    dialog.innerHTML = dialogInner(p);
    dialog.appendChild(makeInput(p));
    document.body.appendChild(dialog);
    shownId = id; freeze();
    dialog.querySelector('[role=textbox]').focus();
  }
  function switchDialog(id) {
    if (swapTimer) clearTimeout(swapTimer);
    swapTimer = setTimeout(() => {
      swapTimer = null;
      if (!dialog || (CFG.neverLoads || []).includes(id)) return;
      const p = byId[id], old = byId[shownId];
      const input = dialog.querySelector('[role=textbox]');
      dialog.innerHTML = dialogInner(p);
      if (input && old && old.author === p.author) { input.setAttribute('data-post-id', p.id); dialog.appendChild(input); }
      else dialog.appendChild(makeInput(p));
      shownId = id;
    }, CFG.swapDelayMs);
  }
  function closeDialog() {
    if (!dialog) return;
    if (swapTimer) { clearTimeout(swapTimer); swapTimer = null; }
    dialog.remove(); dialog = null; shownId = null; unfreeze();
    history.pushState({}, '', '/groups/${GROUP}/');
  }
  // Feed nạp dần: mountedFrom..mountedTo (bài ngoài khoảng là khung trống cùng chiều cao); cuộn xuống thì nạp thêm, gỡ bài trôi xa phía trên.
  let mountedFrom = 0, mountedTo = Math.min(CFG.initialMounted, CFG.posts.length) - 1;
  // Chỉ đổi khung có thay đổi (bài đang hiện giữ nguyên phần tử, như Facebook).
  function renderFeed() {
    const feed = document.querySelector('[role=feed]');
    if (!feed) return;
    if (!feed.children.length) {
      feed.innerHTML = CFG.posts.map((p, i) => '<div class="slot" data-slot="' + i + '"></div>').join('') + '<div class="loading" style="height:60px">Đang tải…</div>';
    }
    CFG.posts.forEach((p, i) => {
      const slot = feed.querySelector('[data-slot="' + i + '"]');
      const want = i >= mountedFrom && i <= mountedTo;
      const has = !!slot.querySelector('[data-post]');
      if (want && !has) slot.innerHTML = postHtml(p);
      if (!want && has) slot.innerHTML = '<div class="placeholder" style="height:420px"></div>';
      if (!want && !slot.innerHTML) slot.innerHTML = '<div class="placeholder" style="height:420px"></div>';
    });
  }
  let lastY = 0;
  window.addEventListener('scroll', () => {
    if (frozen || !document.querySelector('[role=feed]')) return;
    if (window.scrollY - lastY < 300) return;
    lastY = window.scrollY;
    if (mountedTo < CFG.posts.length - 1) mountedTo++;
    if (mountedTo - mountedFrom + 1 > CFG.maxMounted) mountedFrom++;
    renderFeed();
  });
  document.addEventListener('focusin', e => {
    const a = e.target && e.target.closest && e.target.closest('a.ts');
    if (a && a.getAttribute('data-real')) a.setAttribute('href', a.getAttribute('data-real'));
  }, true);
  document.addEventListener('click', e => {
    const button = e.target.closest && e.target.closest('[aria-label^="Bình luận về bài viết của"]');
    if (!button) return;
    if (button.closest('[role=dialog]')) { const input = dialog && dialog.querySelector('[role=textbox]'); if (input) input.focus(); return; }
    const postEl = button.closest('[data-post]');
    const id = postEl.getAttribute('data-post');
    const p = byId[id];
    if (p.foreign) { history.pushState({}, '', '/' + p.page + '/posts/' + id + '/'); if (dialog) switchDialog(id); else openDialog(id); return; }
    if (performance.now() < CFG.readyMs) { location.href = '/groups/${GROUP}/permalink/' + id; return; }
    if (dialog && shownId === id && !swapTimer) return;
    history.pushState({}, '', '/groups/${GROUP}/permalink/' + id + '/');
    if (dialog) switchDialog(id); else openDialog(id);
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && dialog) { closeDialog(); return; }
    if (e.key !== 'Enter') return;
    const input = e.target.closest && e.target.closest('[role=textbox]');
    if (!input || !input.closest('[role=dialog]')) return;
    const text = (input.textContent || '').trim();
    if (!text) return;
    const id = input.getAttribute('data-post-id');
    record({ postId: id, text, path: location.pathname });
    const list = input.closest('[role=dialog]').querySelector('.clist');
    if (list) list.insertAdjacentHTML('afterbegin', '<div role="article"><span class="xt0psk2">Tài khoản thử</span><a href="/groups/${GROUP}/posts/' + id + '/?comment_id=' + Date.now() + '">Vừa xong</a></div>');
    input.textContent = '';
  }, true);
  window.addEventListener('DOMContentLoaded', () => {
    if (CFG.kind === 'group') renderFeed();
    if (CFG.kind === 'permalink') { openDialog(CFG.dialogId); }
  });
})();
</script>`
}

function groupHtml(cfg) {
  const own = cfg.own && cfg.ownVisible !== false ? `<div class="new-posts">{{OWN}}</div>` : ''
  return `<!doctype html><html><head><meta charset="utf-8">${pageScript({ ...cfg, kind: 'group' })}</head><body style="margin:0">
<div role="banner" style="height:56px">Facebook</div>
<div role="main"><div class="group-header" style="height:300px"><h1>Nhóm thử</h1></div>
${(cfg.featured || []).length ? '<div aria-label="Đáng chú ý">{{FEATURED}}</div>' : ''}${own}
<div role="feed"></div></div></body></html>`
}

function permalinkHtml(cfg, id) {
  return `<!doctype html><html><head><meta charset="utf-8">${pageScript({ ...cfg, kind: 'permalink', dialogId: id })}</head><body style="margin:0">
<div role="banner" style="height:56px">Facebook</div>
<div role="main"><div class="home-feed">{{FOREIGN}}{{HIDDEN_COPY}}</div></div></body></html>`
}

/** Dựng HTML đầy đủ (chèn bài vừa đăng / bài nổi bật / bài ngoài nhóm bằng cùng hàm vẽ bài của trang). */
function render(html, cfg, replacements) {
  // Vẽ bằng script của trang để giữ đúng một kiểu bài: dùng hàm đơn giản phía Node cho các khối tĩnh.
  const staticPost = (p, hidden = false) => {
    const tok = 'TOK' + p.id
    const real = (p.foreign ? `/${p.page}/posts/` : `/groups/${GROUP}/posts/`) + `${p.id}/?__cft__[0]=${tok}`
    const ts = cfg.ownLinkLoaded && cfg.own && p.id === cfg.own.id ? real : `?__cft__[0]=${tok}`
    let comments = ''
    for (let i = 0; i < (p.comments || 0); i++) comments += `<div role="article"><a href="/groups/${GROUP}/posts/${p.id}/?comment_id=${500 + i}&__cft__[0]=${tok}">Bình luận cũ</a></div>`
    return `<div class="post" data-post="${p.id}" style="min-height:420px;${hidden ? 'display:none;' : ''}"><h3><a href="/groups/${GROUP}/user/${p.id}/?__cft__[0]=${tok}">${p.author}</a></h3>`
      + `<a class="ts" href="${ts}" data-real="${real}">5 giờ</a><p>Nội dung ${p.id}</p>${comments}`
      + `<div role="button" tabindex="0" aria-label="Bình luận về bài viết của ${p.author}">Bình luận</div></div>`
  }
  let out = html
  for (const [key, posts] of Object.entries(replacements)) out = out.replace(`{{${key}}}`, posts.map(p => staticPost(p.post, p.hidden)).join(''))
  return out.replace(/\{\{[A-Z_]+\}\}/g, '')
}

/**
 * Mở trang nhóm giả trong một context Playwright mới. cfg: { posts, own?, ownVisible?, ownLinkLoaded?, featured?, foreign?, readyMs, swapDelayMs,
 * initialMounted, maxMounted, neverLoads? }. Trả { pw, comments, close }.
 */
async function openFakeGroup(browser, cfg) {
  const full = {
    readyMs: 0, swapDelayMs: 80, initialMounted: 3, maxMounted: 5, ownVisible: true, ownLinkLoaded: true, featured: [], neverLoads: [],
    foreign: { id: '888000999', author: 'Trang ngoài nhóm', page: 'TrangNgoai', foreign: true },
    ...cfg
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } })
  const comments = []
  await context.exposeFunction('__akaRecordComment', rec => { comments.push(rec) })
  await context.route(`${BASE}/**`, route => {
    const url = new URL(route.request().url())
    const permalink = url.pathname.match(new RegExp(`^/groups/${GROUP}/permalink/(\\d+)/?$`))
    let body
    if (permalink) {
      const id = permalink[1]
      const post = full.posts.concat(full.own ? [full.own] : []).concat(full.featured).find(p => p.id === id)
      body = render(permalinkHtml(full, id), full, { FOREIGN: [{ post: full.foreign }], HIDDEN_COPY: post ? [{ post, hidden: true }] : [] })
    } else {
      body = render(groupHtml(full), full, {
        OWN: full.own ? [{ post: full.own }] : [],
        FEATURED: full.featured.map(post => ({ post }))
      })
    }
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
  })
  const pw = await context.newPage()
  await pw.goto(`${BASE}/groups/${GROUP}/`)
  return { pw, comments, close: () => context.close() }
}

// ------------------------------------------------------------------------------------------------ PageController giả (theo pageController.ts)
const SELECTOR_RESOLVER_JS = `
function resolveSelector(selector) {
  if (!selector) return null;
  function isVisible(el) {
    if (!el) return false;
    var s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    return el.offsetWidth > 0 && el.offsetHeight > 0;
  }
  if (selector.startsWith('/') || selector.startsWith('(')) {
    var match = selector.match(/^(.*)\\[(\\d+)\\]$/);
    if (match) {
      var result = document.evaluate(match[1], document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      var visibleEls = [];
      for (var i = 0; i < result.snapshotLength; i++) { var n = result.snapshotItem(i); if (isVisible(n)) visibleEls.push(n); }
      return visibleEls[parseInt(match[2], 10) - 1] || null;
    }
    var r = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (var j = 0; j < r.snapshotLength; j++) { var node = r.snapshotItem(j); if (isVisible(node)) return node; }
    return null;
  }
  var els = document.querySelectorAll(selector);
  for (var k = 0; k < els.length; k++) if (isVisible(els[k])) return els[k];
  return null;
}`

function createPageAdapter(pw, ops) {
  const exec = async code => {
    const result = await pw.evaluate(source => {
      try { return (new Function(source))() } catch (e) { return { __error: true, message: e.message || String(e) } }
    }, `${SELECTOR_RESOLVER_JS}\n${code}`)
    if (result && typeof result === 'object' && result.__error) throw new Error(result.message)
    return result
  }
  const q = JSON.stringify
  const lazy = selector => {
    const n = selector.toLowerCase()
    const textbox = n.includes("role='textbox'") || n.includes('role="textbox"')
    const label = n.includes('bình luận') || n.includes('comment') || n.includes('trả lời')
    return n.includes('write a comment') || n.includes('viết bình luận') || (textbox && label)
  }
  const page = {
    async waitForSelector(selector, opts = {}) {
      const timeout = opts.timeout ?? 30000
      const start = Date.now()
      let polls = 0
      while (Date.now() - start < timeout) {
        const found = await exec(`return !!resolveSelector(${q(selector)});`).catch(() => false)
        if (found) return true
        polls++
        if (lazy(selector) && polls % 3 === 0) {
          await exec('window.scrollBy(0, Math.max(600, Math.floor((window.innerHeight || 800) * 0.85))); return true;').catch(() => false)
          await new Promise(r => setTimeout(r, 100))
          continue
        }
        await new Promise(r => setTimeout(r, 50))
      }
      throw new Error(`waitForSelector timeout: ${selector}`)
    },
    async click(selector) {
      await page.waitForSelector(selector, { timeout: 15000 })
      const label = await exec(`
        var el = resolveSelector(${q(selector)});
        if (!el) throw new Error("Element not found: " + ${q(selector)});
        el.scrollIntoView({ block: "center", inline: "center" });
        var rect = el.getBoundingClientRect();
        var init = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
        var post = el.closest('[data-post]');
        var label = (el.closest('[role=dialog]') ? 'dialog:' : '') + (post ? post.getAttribute('data-post') : (el.getAttribute('aria-label') || '?'));
        el.dispatchEvent(new PointerEvent("pointerdown", Object.assign({}, init, { pointerId: 1, pointerType: "mouse" })));
        el.dispatchEvent(new MouseEvent("mousedown", init));
        el.dispatchEvent(new PointerEvent("pointerup", Object.assign({}, init, { pointerId: 1, pointerType: "mouse" })));
        el.dispatchEvent(new MouseEvent("mouseup", init));
        el.click();
        return label;
      `)
      ops.push({ op: 'click', label })
    },
    async fill(selector, value) {
      await page.waitForSelector(selector, { timeout: 15000 })
      await exec(`
        var el = resolveSelector(${q(selector)});
        if (!el) throw new Error("Element not found: " + ${q(selector)});
        el.focus();
        var range = document.createRange(); range.selectNodeContents(el);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        document.execCommand('delete', false);
        var dt = new DataTransfer(); dt.setData('text/plain', ${q(value)});
        var handled = !el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        if (!handled) document.execCommand('insertText', false, ${q(value)});
        return true;
      `)
      ops.push({ op: 'fill' })
    },
    async type(selector, text) {
      await page.waitForSelector(selector, { timeout: 15000 })
      await exec(`
        var el = resolveSelector(${q(selector)});
        if (!el) throw new Error("Element not found: " + ${q(selector)});
        el.focus();
        var range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        document.execCommand('insertText', false, ${q(text)});
        return true;
      `)
    },
    async press(key) {
      const info = { Enter: { key: 'Enter', code: 'Enter', keyCode: 13 }, Escape: { key: 'Escape', code: 'Escape', keyCode: 27 } }[key] || { key, code: key, keyCode: 0 }
      await exec(`
        var info = ${q(info)};
        var target = document.activeElement || document.body;
        target.dispatchEvent(new KeyboardEvent("keydown", Object.assign({}, info, { bubbles: true })));
        target.dispatchEvent(new KeyboardEvent("keypress", Object.assign({}, info, { bubbles: true })));
        target.dispatchEvent(new KeyboardEvent("keyup", Object.assign({}, info, { bubbles: true })));
        return true;
      `)
      ops.push({ op: 'press', label: key })
    },
    async evaluate(code, ...args) {
      return await pw.evaluate(({ code, args }) => {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
        return new AsyncFunction('__args', code)(args)
      }, { code, args })
    },
    async navigate(url) { ops.push({ op: 'navigate', label: url }); await pw.goto(url) },
    async dropFile() { return { fileCount: 0 } },
    getURL() { return pw.url() }
  }
  return page
}

module.exports = { GROUP, BASE, openFakeGroup, createPageAdapter }
