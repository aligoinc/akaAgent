// V472: when the dialog comment box is missing, classify the opened page and
// return a standard result instead of throwing. Customer text never shows XPath.
const COMMENT_BOX_NOT_FOUND = 'err_fb_comment_box_not_found'
const COMMENT_UNAVAILABLE_RULES = [
  { reason: 'post_not_found', statusCode: 'campaign_detail_not_found',
    errorCode: 'err_fb_comment_unavailable_post_not_found', message: 'Không tìm thấy bài Facebook để bình luận',
    phrases: ['bạn hiện không xem được nội dung này', 'nội dung này hiện không hiển thị', 'nội dung này hiện không có',
      'liên kết bạn truy cập có thể bị hỏng', "this content isn't available", 'this content is not available',
      "this page isn't available", 'the link you followed may be broken'] },
  { reason: 'comment_disabled', statusCode: 'campaign_detail_failed',
    errorCode: 'err_fb_comment_unavailable_comment_disabled', message: 'Bài Facebook đã tắt bình luận',
    phrases: ['đã tắt tính năng bình luận', 'tính năng bình luận đã bị tắt', 'đã tắt bình luận', 'bình luận đã bị tắt',
      'commenting has been turned off', 'comments have been turned off', 'turned off commenting', 'comments are turned off'] },
  { reason: 'post_pending', statusCode: 'campaign_detail_failed',
    errorCode: 'err_fb_comment_unavailable_post_pending', message: 'Bài Facebook đang chờ duyệt nên chưa bình luận được',
    phrases: ['bài viết của bạn đang chờ', 'đang chờ quản trị viên phê duyệt', 'your post is pending', 'pending admin approval'] },
  { reason: 'not_member', statusCode: 'campaign_detail_failed',
    errorCode: 'err_fb_comment_unavailable_not_member', message: 'Chưa đủ quyền thành viên để bình luận trong nhóm',
    phrases: ['tham gia nhóm để bình luận', 'chỉ thành viên mới có thể bình luận', 'join group to comment', 'only members can comment'],
    // Only when the post itself is not shown, so an ad text cannot trigger it.
    gatePhrases: ['tham gia nhóm để xem', 'join this group to', 'join group to view'] }
]

async function readCommentPageSignals() {
  return await page.evaluate(`
    const norm = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible);
    const main = document.querySelector('[role="main"]');
    const scope = dialogs.length ? dialogs[dialogs.length - 1] : (main || document.body);
    const skip = '[data-ad-preview="message"], [data-ad-comet-preview="message"]';
    const texts = [];
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && texts.length < 400) {
      const el = walker.currentNode.parentElement;
      if (!el || el.closest(skip) || !visible(el)) continue;
      const text = norm(el.innerText || el.textContent);
      if (text.length < 6 || text.length > 200 || seen.has(text)) continue;
      seen.add(text);
      texts.push(text);
    }
    const headings = Array.from(document.querySelectorAll('[role="heading"], h1, h2'))
      .filter(visible).map(el => norm(el.innerText || el.textContent)).filter(Boolean)
      .slice(0, 6).map(text => text.slice(0, 120));
    return {
      url: String(location.href || ''),
      title: norm(document.title).slice(0, 120),
      hasDialog: dialogs.length > 0,
      articleCount: scope ? scope.querySelectorAll('[role="article"]').length : 0,
      headings,
      texts
    };
  `)
}

function normalizeCommentPageText(value) {
  return String(value || '').normalize('NFC').replace(/[‘’]/g, "'").toLowerCase()
}

function classifyCommentPage(signals) {
  const url = String((signals && signals.url) || '')
  if (/\/checkpoint\//i.test(url)) {
    return { reason: 'checkpoint', statusCode: 'campaign_detail_error', errorCode: COMMENT_BOX_NOT_FOUND,
      message: 'Facebook yêu cầu xác minh tài khoản (checkpoint)' }
  }
  if (/\/login(\.php)?([/?#]|$)/i.test(url)) {
    return { reason: 'logged_out', statusCode: 'campaign_detail_error', errorCode: COMMENT_BOX_NOT_FOUND,
      message: 'Tài khoản Facebook đã bị đăng xuất' }
  }
  const texts = (signals && Array.isArray(signals.texts) ? signals.texts : []).map(normalizeCommentPageText)
  const articleCount = Number((signals && signals.articleCount) || 0)
  for (const rule of COMMENT_UNAVAILABLE_RULES) {
    const phrases = rule.phrases.concat(articleCount === 0 && rule.gatePhrases ? rule.gatePhrases : [])
    const matched = phrases.find(phrase => texts.some(text => text.includes(phrase)))
    if (matched) {
      return { reason: rule.reason, statusCode: rule.statusCode, errorCode: rule.errorCode, message: rule.message, matched }
    }
  }
  return { reason: 'unknown', statusCode: 'campaign_detail_error', errorCode: COMMENT_BOX_NOT_FOUND,
    message: 'Không tìm thấy ô bình luận trên bài' }
}

async function waitForCommentBox(selector) {
  try {
    await page.waitForSelector(selector, { timeout: 8000 })
    return null
  } catch (cause) {
    const raw = cause && cause.message ? String(cause.message) : String(cause)
    if (signal.aborted || !raw.startsWith('waitForSelector timeout:')) throw cause
    const signals = (await readCommentPageSignals()) || {}
    const result = classifyCommentPage(signals)
    helpers.log('⚠️ ' + result.message)
    // No "error" key: that field becomes the pause-note reason in the runtime.
    const data = {
      reason: result.reason,
      matched: result.matched || null,
      url: String(signals.url || '').slice(0, 300),
      title: String(signals.title || ''),
      hasDialog: signals.hasDialog === true,
      articleCount: Number(signals.articleCount || 0),
      headings: Array.isArray(signals.headings) ? signals.headings.slice(0, 6) : [],
      rawError: raw.slice(0, 300),
      source: 'fb_comment_current_post'
    }
    if (result.reason === 'unknown') {
      data.sample = (Array.isArray(signals.texts) ? signals.texts : []).slice(0, 12).map(t => String(t).slice(0, 100))
    }
    return {
      commented: false, commentFailed: true, position: 1, text, imageCount: 0, error: result.message,
      actionResult: {
        actionCode: 'fb_comment', statusCode: result.statusCode, errorCode: result.errorCode,
        inputDataId: vars.inputDataId ?? null, operationState: 'not_committed', message: result.message, data
      }
    }
  }
}

const inputXpath = await helpers.element('fb_comment_dialog_textbox')
const commentUnavailable = await waitForCommentBox(inputXpath)
if (commentUnavailable) return commentUnavailable
