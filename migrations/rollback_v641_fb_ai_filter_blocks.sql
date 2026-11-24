-- rollback_v641_fb_ai_filter_blocks: trả 10 block lọc AI về code trước V641 (kiểm md5 bản V641 trước khi ghi). Mã cấu hình cũ vẫn còn nên chạy lại như trước.
BEGIN;
SET LOCAL lock_timeout = '3s';

UPDATE public.auto_blocks SET code = $v641$
const AI_USING_CODE = 'fb_prepare_seeding_iterations_ai_filter'
// Giữ cách cuộn 1500px cũ, nhưng có trần cứng để feed load vô tận vẫn thoát.
const rawRequestedCount = Number(input.limit || vars.postsPerTarget || 3)
const N = Number.isFinite(rawRequestedCount) && rawRequestedCount > 0
  ? Math.max(1, Math.floor(rawRequestedCount))
  : 3
const MAX_NO_GROWTH_CYCLES = 3
const MAX_SCROLL_CYCLES = 20
const MAX_SCANNED_POSTS = Math.max(30, N * 10)
const keywordEnabled = vars.isFindPostByKeywords === true && String(vars.postKeywords || '').trim().length > 0
const kwRaw = keywordEnabled ? String(vars.postKeywords || '') : ''
const aiEnabled = vars.isFindPostByContentAI === true && String(vars.postContentAI || '').trim().length > 0
const aiPrompt = aiEnabled ? String(vars.postContentAI || '').trim() : ''
const variants = Array.isArray(vars.commentVariants) ? vars.commentVariants : []
const imageBatches = Array.isArray(vars.commentImageBatches) ? vars.commentImageBatches : []

function normalizeForMatch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)))
}

const keywords = kwRaw.split(',').map(normalizeForMatch).filter(Boolean)

function splitMeaningTraits(prompt) {
  const lines = String(prompt || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
  return lines.length > 0 ? lines : [String(prompt || '').trim()].filter(Boolean)
}

function extractAIText(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(extractAIText).filter(Boolean).join('\n').trim()
  if (typeof value === 'object') {
    const data = value
    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result
    if (direct !== undefined && direct !== null && direct !== value) {
      const directText = extractAIText(direct)
      if (directText) return directText
    }
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return String(value || '').trim()
}

function extractJsonText(raw) {
  const trimmed = String(raw || '').trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const text = (fenced ? fenced[1] : trimmed).trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : text
}

function createEmptyMeaningAiCheck() {
  return { ok: true, matched: true, checkResult: '', prompt: aiPrompt, finalPrompt: '', rawResult: '', reason: '', error: '' }
}

function normalizeMeaningAiResult(result) {
  const raw = result && typeof result === 'object' ? result : {}
  if (!result || result.ok !== true) {
    const error = String(raw.error || raw.message || 'AI lỗi')
    return { ok: false, matched: false, checkResult: 'error', prompt: aiPrompt, finalPrompt: '', rawResult: '', reason: error, error }
  }
  const rawResult = extractAIText(raw.content ?? raw.data ?? raw.text ?? raw.output ?? raw.response ?? raw.rawResponse ?? raw)
  let matched = false
  let reason = ''
  try {
    const parsed = JSON.parse(extractJsonText(rawResult))
    matched = parsed.matched === true || parsed.match === true || String(parsed.result || parsed.checkResult || '').toLowerCase() === 'matched'
    reason = String(parsed.reason || parsed.explanation || parsed.message || '').trim()
  } catch {
    const normalized = rawResult.toLowerCase()
    matched = normalized.includes('matched') || normalized.includes('true') || normalized.includes('phù hợp') || normalized.includes('phu hop') || normalized.includes('có')
    reason = rawResult.slice(0, 500)
  }
  return {
    ok: true,
    matched,
    checkResult: matched ? 'matched' : 'not_matched',
    prompt: aiPrompt,
    finalPrompt: String(raw.renderedUserPrompt || raw.rendered_user_prompt || ''),
    rawResult,
    reason,
    error: ''
  }
}

async function checkMeaningAi(content) {
  if (!aiEnabled) return createEmptyMeaningAiCheck()
  if (typeof helpers.callAIUsing !== 'function') {
    return { ok: false, matched: false, checkResult: 'error', prompt: aiPrompt, finalPrompt: '', rawResult: '', reason: 'Runtime chưa hỗ trợ helper callAIUsing', error: 'Runtime chưa hỗ trợ helper callAIUsing' }
  }
  const traits = splitMeaningTraits(aiPrompt)
  const criteria = traits.map((trait, index) => (index + 1) + '. ' + trait).join('\n')
  const result = await helpers.callAIUsing(AI_USING_CODE, {
    prompt: aiPrompt,
    criteria,
    entity_type: 'post',
    entityType: 'post',
    content: JSON.stringify(String(content || '')),
    contentText: String(content || '')
  })
  return normalizeMeaningAiResult(result)
}

function isMeaningAiAccepted(aiCheck) {
  return !aiEnabled || (aiCheck && aiCheck.ok === true && aiCheck.matched === true)
}

function isMeaningAiFailed(aiCheck) {
  return aiEnabled && (!aiCheck || aiCheck.ok !== true)
}

function getMeaningAiMessage(aiCheck) {
  if (isMeaningAiFailed(aiCheck)) {
    return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân')
  }
  if (aiEnabled && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI'
  return 'Đúng ý nghĩa AI'
}

function buildFilterData(matchedKeyword, aiCheck) {
  const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : '')
  const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : '')
  return {
    keywordEnabled,
    keyword: keywordEnabled ? kwRaw : null,
    matchedKeyword: keywordEnabled ? matchedKeyword : null,
    aiPrompt: aiPrompt || null,
    aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''),
    aiRawResult: rawResult,
    aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''),
    aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null,
    aiReason: reason || null,
    aiResult: rawResult || null
  }
}

async function logPostSearchEvent(event) {
  if (typeof helpers.logRunEvent !== 'function') return
  try { await helpers.logRunEvent(event) } catch (e) {}
}

const selectors = {
  posts: await helpers.element('fb_post_in_uid'),
  seeMore: await helpers.element('fb_see_more_content_post_btn'),
  content: await helpers.element('fb_content_in_post_in_uid'),
  rawPostLink: await helpers.element('RawPostLinkInUid'),
  postLink: await helpers.element('PostLinkInUid')
}

const hasSearchConditions = keywordEnabled || aiEnabled
try {
  await page.evaluate('window.scrollTo({ top: 0, behavior: "instant" });')
} catch (e) {}
await helpers.sleep(2500, signal)

const evalCode = `
  const selectors = __args[0];

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function xpathAll(xpath, root) {
    const out = [];
    if (!xpath) return out;
    const context = root || document;
    try {
      const result = document.evaluate(xpath, context, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
    } catch {}
    const filtered = out.filter(Boolean);
    if (root && root !== document && root.nodeType === 1) {
      return filtered.filter(el => el === root || (root.contains && root.contains(el)));
    }
    return filtered;
  }

  function clickSynthetic(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); } catch {}
  }

  function hrefOf(el) {
    try { return String(el && el.href ? el.href : el && el.getAttribute ? el.getAttribute('href') || '' : ''); } catch { return ''; }
  }

  function cleanPostHref(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    try {
      const url = new URL(value, window.location.origin);
      const blockedParams = [
        '__cft__', '__tn__', 'comment_id', 'reply_comment_id', 'notif_id', 'notif_t',
        'ref', 'refid', 'mibextid', 'locale', 'paipv', 'eav', 'av', 'rdid',
        'share_url', 'idorvanity'
      ];
      for (const param of blockedParams) url.searchParams.delete(param);
      url.hash = '';
      return url.toString();
    } catch {
      return value;
    }
  }

  function isPostPermalink(raw) {
    const href = String(raw || '');
    if (!href || href.includes('comment_id=') || href.includes('reply_comment_id=')) return false;
    return href.includes('/posts/') || href.includes('/pending_posts/') || href.includes('story_fbid=');
  }

  function firstPostLink(post) {
    const links = [];
    try { links.push(...xpathAll(selectors.postLink, post)); } catch {}
    try { links.push(...Array.from(post.querySelectorAll('a[href]')).filter(a => isPostPermalink(hrefOf(a)))); } catch {}
    for (const link of links) {
      const href = hrefOf(link);
      if (isPostPermalink(href)) return cleanPostHref(href);
    }
    return '';
  }

  async function resolvePostLink(post) {
    let rawPostLink = '';
    let postLink = firstPostLink(post);
    if (postLink) return { rawPostLink, postLink };

    let rawLinks = [];
    try { rawLinks.push(...xpathAll(selectors.rawPostLink, post)); } catch {}
    try { rawLinks.push(...Array.from(post.querySelectorAll('a[target="_blank"][href*="?__cft__"]'))); } catch {}
    rawLinks = rawLinks.slice(0, 5);
    for (const rawLinkEl of rawLinks) {
      const href = hrefOf(rawLinkEl);
      rawPostLink = rawPostLink || cleanPostHref(href);
      try { rawLinkEl.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true, view: window })); } catch {}
      await delay(450);
      postLink = firstPostLink(post);
      if (postLink) break;
    }
    return { rawPostLink, postLink };
  }

  function uniqueText(parts) {
    const seen = {};
    const out = [];
    for (const part of parts || []) {
      const text = String(part || '').replace(/\\s+/g, ' ').trim();
      if (!text || seen[text]) continue;
      seen[text] = 1;
      out.push(text);
    }
    return out;
  }

  const postElements = xpathAll(selectors.posts).filter(isVisible);
  const rows = [];

  for (let i = 0; i < postElements.length; i++) {
    const post = postElements[i];
    try {
      post.scrollIntoView({ block: 'center', inline: 'nearest' });
      await delay(300);
    } catch {}

    try {
      const seeMoreButtons = xpathAll(selectors.seeMore, post).filter(isVisible).slice(0, 5);
      for (const btn of seeMoreButtons) {
        clickSynthetic(btn);
        await delay(300);
      }
    } catch {}

    let contentParts = xpathAll(selectors.content, post)
      .map(el => (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim())
      .filter(Boolean);

    if (contentParts.length === 0) {
      contentParts = Array.from(post.querySelectorAll('[data-ad-rendering-role="message"], [data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"], [data-ad-preview="message"], [dir="auto"]'))
        .filter(isVisible)
        .map(el => (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim())
        .filter(Boolean);
    }

    let content = uniqueText(contentParts).join('\\n').trim();
    if (!content) content = (post.innerText || post.textContent || '').trim();
    const linkInfo = await resolvePostLink(post);

    rows.push({
      position: i + 1,
      content,
      rawPostLink: linkInfo.rawPostLink || '',
      postLink: linkInfo.postLink || ''
    });
  }

  return { posts: rows, count: postElements.length };
`

const result = []
const samples = []
const processedPostKeys = new Set()
let scannedCount = 0
let keywordMatchedCount = 0
let aiMatchedCount = 0
let skippedCount = 0
let failedCount = 0
let readCycles = 0
let scrollCycles = 0
let noGrowthCycles = 0
let lastVisiblePostCount = 0
let stopReason = ''

function getPostKey(post, position, rawText) {
  const linkKey = String(post && (post.postLink || post.rawPostLink) ? (post.postLink || post.rawPostLink) : '').trim()
  if (linkKey) return 'url:' + linkKey
  const textKey = normalizeForMatch(rawText).slice(0, 220)
  if (textKey) return 'text:' + textKey
  return 'position:' + position
}

async function processPost(post) {
  const rawText = String(post && post.content ? post.content : '')
  const normalizedText = normalizeForMatch(rawText)
  const position = Number(post && post.position ? post.position : scannedCount + 1)
  const key = getPostKey(post, position, rawText)
  if (processedPostKeys.has(key)) return false
  if (scannedCount >= MAX_SCANNED_POSTS) return false
  processedPostKeys.add(key)

  const postUrl = String(post && post.postLink ? post.postLink : '')
  const rawPostLink = String(post && post.rawPostLink ? post.rawPostLink : '')
  const postLinksForLog = postUrl ? [postUrl] : []
  scannedCount++

  if (samples.length < 3 && rawText) samples.push(rawText.replace(/\s+/g, ' ').trim().slice(0, 120))

  const contentMatches = !keywordEnabled || keywords.length === 0 || keywords.some(k => normalizedText.includes(k))
  if (keywordEnabled && contentMatches) keywordMatchedCount++

  if (!contentMatches) {
    skippedCount++
    await logPostSearchEvent({
      eventType: 'extract_post_data',
      eventName: 'Tìm bài post để comment',
      targetType: 'post',
      status: 'skipped',
      isUserVisible: true,
      itemIndex: position,
      targetUrl: postUrl,
      message: 'Không chứa keyword',
      extractedData: {
        entity: { type: 'post', url: postUrl, name: null, uid: null, contentText: rawText },
        filters: buildFilterData(false, createEmptyMeaningAiCheck()),
        values: { phones: [], zaloGroupLinks: [], postLinks: postLinksForLog, uids: [] }
      },
      debugData: { rawPostLink, postIndex: position, readCycles }
    })
    return true
  }

  const meaningAiCheck = await checkMeaningAi(rawText)
  const meaningAiAccepted = isMeaningAiAccepted(meaningAiCheck)
  if (aiEnabled && meaningAiAccepted) aiMatchedCount++

  if (!meaningAiAccepted) {
    if (isMeaningAiFailed(meaningAiCheck)) failedCount++
    else skippedCount++
    await logPostSearchEvent({
      eventType: 'extract_post_data',
      eventName: 'Tìm bài post để comment',
      targetType: 'post',
      status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped',
      isUserVisible: true,
      itemIndex: position,
      targetUrl: postUrl,
      message: getMeaningAiMessage(meaningAiCheck),
      extractedData: {
        entity: { type: 'post', url: postUrl, name: null, uid: null, contentText: rawText },
        filters: buildFilterData(contentMatches, meaningAiCheck),
        values: { phones: [], zaloGroupLinks: [], postLinks: postLinksForLog, uids: [] }
      },
      debugData: { rawPostLink, postIndex: position, readCycles }
    })
    return true
  }

  if (result.length < N) {
    const iterationIndex = result.length
    result.push({
      position,
      text: variants.length > 0 ? variants[iterationIndex % variants.length] : '',
      images: Array.isArray(imageBatches[iterationIndex]) ? imageBatches[iterationIndex] : [],
      postUrl
    })
    await logPostSearchEvent({
      eventType: 'extract_post_data',
      eventName: 'Tìm bài post để comment',
      targetType: 'post',
      status: 'success',
      isUserVisible: true,
      itemIndex: position,
      targetUrl: postUrl,
      message: 'Đã chọn bài post #' + position + ' để comment',
      extractedData: {
        entity: { type: 'post', url: postUrl, name: null, uid: null, contentText: rawText },
        filters: buildFilterData(contentMatches, meaningAiCheck),
        values: { phones: [], zaloGroupLinks: [], postLinks: postLinksForLog, uids: [] }
      },
      debugData: { rawPostLink, postIndex: position, selectedIndex: iterationIndex + 1, readCycles }
    })
  }

  return true
}

while (!(signal && signal.aborted) && result.length < N) {
  if (scannedCount >= MAX_SCANNED_POSTS) {
    stopReason = 'max_scanned_posts'
    break
  }
  if (noGrowthCycles >= MAX_NO_GROWTH_CYCLES) {
    stopReason = 'no_new_posts'
    break
  }

  // Một vòng = đọc batch DOM đang render. Chỉ khi chưa đủ bài mới cuộn tiếp.
  readCycles++
  let postData = { posts: [], count: 0 }
  try { postData = await page.evaluate(evalCode, selectors) } catch (e) {
    stopReason = 'read_error'
    helpers.log('⚠️ Lỗi đọc nội dung bài viết: ' + (e && e.message || e))
    break
  }

  const posts = Array.isArray(postData.posts) ? postData.posts : []
  lastVisiblePostCount = Number(postData.count || posts.length || 0)
  const beforeProcessedCount = processedPostKeys.size
  let hitScanCapInBatch = false

  for (const post of posts) {
    if (signal && signal.aborted) break
    // Không vượt quá tổng số bài đã quét, kể cả khi 1 batch DOM rất dài.
    if (scannedCount >= MAX_SCANNED_POSTS) {
      hitScanCapInBatch = true
      break
    }
    await processPost(post)
    if (result.length >= N) break
    if (scannedCount >= MAX_SCANNED_POSTS) {
      hitScanCapInBatch = true
      break
    }
  }

  const newPostCount = processedPostKeys.size - beforeProcessedCount
  helpers.log('🔍 Vòng tìm bài ' + readCycles + ': đọc ' + lastVisiblePostCount + ' bài đang thấy, thêm ' + newPostCount + ' bài mới, đã chọn ' + result.length + '/' + N)

  if (result.length >= N) {
    stopReason = 'enough_matches'
    break
  }
  if (signal && signal.aborted) {
    stopReason = 'cancelled'
    break
  }
  if (hitScanCapInBatch || scannedCount >= MAX_SCANNED_POSTS) {
    stopReason = 'max_scanned_posts'
    break
  }

  if (newPostCount <= 0) noGrowthCycles++
  else noGrowthCycles = 0

  if (noGrowthCycles >= MAX_NO_GROWTH_CYCLES) {
    stopReason = 'no_new_posts'
    break
  }

  // Dù feed cứ load bài mới mãi nhưng đều trượt keyword/AI thì vẫn chỉ cuộn tối đa 20 lần.
  // readCycles có thể là MAX_SCROLL_CYCLES + 1 vì batch đầu tiên đọc trước khi cuộn.
  if (scrollCycles >= MAX_SCROLL_CYCLES) {
    stopReason = 'max_scroll_cycles'
    break
  }

  try { await page.scroll({ direction: 'down', amount: 1500 }) } catch (e) {}
  scrollCycles++
  await helpers.sleep(2000, signal)
}

if (!stopReason) {
  if (signal && signal.aborted) stopReason = 'cancelled'
  else if (result.length >= N) stopReason = 'enough_matches'
  else if (scannedCount >= MAX_SCANNED_POSTS) stopReason = 'max_scanned_posts'
  else if (noGrowthCycles >= MAX_NO_GROWTH_CYCLES) stopReason = 'no_new_posts'
  else if (scrollCycles >= MAX_SCROLL_CYCLES) stopReason = 'max_scroll_cycles'
}

const reachedHardSearchLimit = result.length < N && (stopReason === 'max_scanned_posts' || stopReason === 'max_scroll_cycles')
const hardLimitLabel = stopReason === 'max_scanned_posts'
  ? 'đã chạm giới hạn quét ' + MAX_SCANNED_POSTS + ' bài'
  : stopReason === 'max_scroll_cycles'
    ? 'đã chạm giới hạn cuộn ' + MAX_SCROLL_CYCLES + ' vòng'
    : ''
const hardLimitMessage = reachedHardSearchLimit
  ? 'Đã quét ' + scannedCount + ' bài / ' + scrollCycles + ' vòng cuộn, chỉ chọn được ' + result.length + '/' + N + ' bài phù hợp (' + hardLimitLabel + ').'
  : ''

if (reachedHardSearchLimit) {
  // Báo rõ lý do thiếu bài kể cả đã chọn được một phần, để user không nghĩ workflow bị kẹt.
  helpers.log('⚠️ ' + hardLimitMessage)
  if (result.length === 0 && hasSearchConditions && samples.length > 0) {
    helpers.log('ℹ️ Nội dung đã đọc thử: ' + samples.join(' | '))
  }
  if (result.length > 0) {
    helpers.log('📋 Sẽ comment vào ' + result.length + '/' + N + ' bài' + (hasSearchConditions ? ' theo điều kiện tìm kiếm bài post' : ''))
  }
} else if (result.length === 0) {
  if (scannedCount === 0) {
    helpers.log('⚠️ Không tìm thấy bài viết nào. Tài khoản có thể chưa được duyệt vào nhóm hoặc trang chưa load xong.')
  } else if (hasSearchConditions) {
    helpers.log('⚠️ Có ' + scannedCount + ' bài viết đã quét nhưng không khớp điều kiện tìm kiếm bài post')
    if (samples.length > 0) helpers.log('ℹ️ Nội dung đã đọc thử: ' + samples.join(' | '))
  } else {
    helpers.log('⚠️ Chưa chuẩn bị được danh sách bài để comment')
  }
} else {
  helpers.log('📋 Sẽ comment vào ' + result.length + '/' + N + ' bài' + (hasSearchConditions ? ' theo điều kiện tìm kiếm bài post' : ''))
}

const summaryMessage = hardLimitMessage || ('Đã chọn ' + result.length + '/' + N + ' bài phù hợp từ ' + scannedCount + ' bài đã quét')

await logPostSearchEvent({
  eventType: 'comment_seeding_post_search_summary',
  eventName: 'Tổng kết tìm bài post',
  targetType: 'summary',
  status: 'success',
  isUserVisible: true,
  elementCount: result.length,
  message: summaryMessage,
  extractedData: {
    entity: { type: 'summary', url: '', name: String(vars.inputDataName || vars.campaignInputDataName || ''), uid: null, contentText: summaryMessage },
    filters: buildFilterData(keywordEnabled ? result.length > 0 : null, createEmptyMeaningAiCheck()),
    values: { phones: [], zaloGroupLinks: [], postLinks: unique(result.map(item => item.postUrl)), uids: [] }
  },
  debugData: {
    requestedCount: N,
    visiblePostCount: lastVisiblePostCount,
    scannedCount,
    matchedCount: result.length,
    readCycles,
    scrollCycles,
    noGrowthCycles,
    stopReason,
    maxScannedPosts: MAX_SCANNED_POSTS,
    maxScrollCycles: MAX_SCROLL_CYCLES,
    maxNoGrowthCycles: MAX_NO_GROWTH_CYCLES,
    hardLimitReached: reachedHardSearchLimit,
    keywordMatchedCount,
    aiMatchedCount,
    skippedCount,
    failedCount,
    keywordEnabled,
    aiEnabled
  }
})

return {
  commentIterations: result,
  totalCount: scannedCount,
  matchedCount: result.length,
  scannedCount,
  readCycles,
  scrollCycles,
  noGrowthCycles,
  stopReason,
  maxScannedPosts: MAX_SCANNED_POSTS,
  maxScrollCycles: MAX_SCROLL_CYCLES,
  maxNoGrowthCycles: MAX_NO_GROWTH_CYCLES,
  hardLimitReached: reachedHardSearchLimit,
  keywordMatchedCount,
  aiMatchedCount,
  skippedCount,
  failedCount
}
$v641$, updated_at = now()
 WHERE id = 2554 AND md5(code) = '091f57483369c8b03fea65e9eba0390c';

UPDATE public.auto_blocks SET code = $v641$
const AI_USING_CODE = 'fb_prepare_seeding_iterations_ai_filter'
// Giữ cách cuộn 1500px cũ, nhưng có trần cứng để feed load vô tận vẫn thoát.
const rawRequestedCount = Number(input.limit || vars.postsPerTarget || 3)
const N = Number.isFinite(rawRequestedCount) && rawRequestedCount > 0
  ? Math.max(1, Math.floor(rawRequestedCount))
  : 3
const MAX_NO_GROWTH_CYCLES = 3
const MAX_SCROLL_CYCLES = 20
const MAX_SCANNED_POSTS = Math.max(30, N * 10)
const keywordEnabled = vars.isFindPostByKeywords === true && String(vars.postKeywords || '').trim().length > 0
const kwRaw = keywordEnabled ? String(vars.postKeywords || '') : ''
const aiEnabled = vars.isFindPostByContentAI === true && String(vars.postContentAI || '').trim().length > 0
const aiPrompt = aiEnabled ? String(vars.postContentAI || '').trim() : ''
const variants = Array.isArray(vars.commentVariants) ? vars.commentVariants : []
const imageBatches = Array.isArray(vars.commentImageBatches) ? vars.commentImageBatches : []

function normalizeForMatch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)))
}

const keywords = kwRaw.split(',').map(normalizeForMatch).filter(Boolean)

function splitMeaningTraits(prompt) {
  const lines = String(prompt || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
  return lines.length > 0 ? lines : [String(prompt || '').trim()].filter(Boolean)
}

function extractAIText(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(extractAIText).filter(Boolean).join('\n').trim()
  if (typeof value === 'object') {
    const data = value
    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result
    if (direct !== undefined && direct !== null && direct !== value) {
      const directText = extractAIText(direct)
      if (directText) return directText
    }
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return String(value || '').trim()
}

function extractJsonText(raw) {
  const trimmed = String(raw || '').trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const text = (fenced ? fenced[1] : trimmed).trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : text
}

function createEmptyMeaningAiCheck() {
  return { ok: true, matched: true, checkResult: '', prompt: aiPrompt, finalPrompt: '', rawResult: '', reason: '', error: '' }
}

function normalizeMeaningAiResult(result) {
  const raw = result && typeof result === 'object' ? result : {}
  if (!result || result.ok !== true) {
    const error = String(raw.error || raw.message || 'AI lỗi')
    return { ok: false, matched: false, checkResult: 'error', prompt: aiPrompt, finalPrompt: '', rawResult: '', reason: error, error }
  }
  const rawResult = extractAIText(raw.content ?? raw.data ?? raw.text ?? raw.output ?? raw.response ?? raw.rawResponse ?? raw)
  let matched = false
  let reason = ''
  try {
    const parsed = JSON.parse(extractJsonText(rawResult))
    matched = parsed.matched === true || parsed.match === true || String(parsed.result || parsed.checkResult || '').toLowerCase() === 'matched'
    reason = String(parsed.reason || parsed.explanation || parsed.message || '').trim()
  } catch {
    const normalized = rawResult.toLowerCase()
    matched = normalized.includes('matched') || normalized.includes('true') || normalized.includes('phù hợp') || normalized.includes('phu hop') || normalized.includes('có')
    reason = rawResult.slice(0, 500)
  }
  return {
    ok: true,
    matched,
    checkResult: matched ? 'matched' : 'not_matched',
    prompt: aiPrompt,
    finalPrompt: String(raw.renderedUserPrompt || raw.rendered_user_prompt || ''),
    rawResult,
    reason,
    error: ''
  }
}

async function checkMeaningAi(content) {
  if (!aiEnabled) return createEmptyMeaningAiCheck()
  if (typeof helpers.callAIUsing !== 'function') {
    return { ok: false, matched: false, checkResult: 'error', prompt: aiPrompt, finalPrompt: '', rawResult: '', reason: 'Runtime chưa hỗ trợ helper callAIUsing', error: 'Runtime chưa hỗ trợ helper callAIUsing' }
  }
  const traits = splitMeaningTraits(aiPrompt)
  const criteria = traits.map((trait, index) => (index + 1) + '. ' + trait).join('\n')
  const result = await helpers.callAIUsing(AI_USING_CODE, {
    prompt: aiPrompt,
    criteria,
    entity_type: 'post',
    entityType: 'post',
    content: JSON.stringify(String(content || '')),
    contentText: String(content || '')
  })
  return normalizeMeaningAiResult(result)
}

function isMeaningAiAccepted(aiCheck) {
  return !aiEnabled || (aiCheck && aiCheck.ok === true && aiCheck.matched === true)
}

function isMeaningAiFailed(aiCheck) {
  return aiEnabled && (!aiCheck || aiCheck.ok !== true)
}

function getMeaningAiMessage(aiCheck) {
  if (isMeaningAiFailed(aiCheck)) {
    return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân')
  }
  if (aiEnabled && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI'
  return 'Đúng ý nghĩa AI'
}

function buildFilterData(matchedKeyword, aiCheck) {
  const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : '')
  const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : '')
  return {
    keywordEnabled,
    keyword: keywordEnabled ? kwRaw : null,
    matchedKeyword: keywordEnabled ? matchedKeyword : null,
    aiPrompt: aiPrompt || null,
    aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''),
    aiRawResult: rawResult,
    aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''),
    aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null,
    aiReason: reason || null,
    aiResult: rawResult || null
  }
}

async function logPostSearchEvent(event) {
  if (typeof helpers.logRunEvent !== 'function') return
  try { await helpers.logRunEvent(event) } catch (e) {}
}

const selectors = {
  posts: await helpers.element('fb_post_in_uid'),
  seeMore: await helpers.element('fb_see_more_content_post_btn'),
  content: await helpers.element('fb_content_in_post_in_uid'),
  rawPostLink: await helpers.element('RawPostLinkInUid'),
  postLink: await helpers.element('PostLinkInUid')
}

const hasSearchConditions = keywordEnabled || aiEnabled
try {
  await page.evaluate('window.scrollTo({ top: 0, behavior: "instant" });')
} catch (e) {}
await helpers.sleep(2500, signal)

const evalCode = `
  const selectors = __args[0];

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function xpathAll(xpath, root) {
    const out = [];
    if (!xpath) return out;
    const context = root || document;
    try {
      const result = document.evaluate(xpath, context, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
    } catch {}
    const filtered = out.filter(Boolean);
    if (root && root !== document && root.nodeType === 1) {
      return filtered.filter(el => el === root || (root.contains && root.contains(el)));
    }
    return filtered;
  }

  function clickSynthetic(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); } catch {}
  }

  function hrefOf(el) {
    try { return String(el && el.href ? el.href : el && el.getAttribute ? el.getAttribute('href') || '' : ''); } catch { return ''; }
  }

  function cleanPostHref(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    try {
      const url = new URL(value, window.location.origin);
      const blockedParams = [
        '__cft__', '__tn__', 'comment_id', 'reply_comment_id', 'notif_id', 'notif_t',
        'ref', 'refid', 'mibextid', 'locale', 'paipv', 'eav', 'av', 'rdid',
        'share_url', 'idorvanity'
      ];
      for (const param of blockedParams) url.searchParams.delete(param);
      url.hash = '';
      return url.toString();
    } catch {
      return value;
    }
  }

  function isPostPermalink(raw) {
    const href = String(raw || '');
    if (!href || href.includes('comment_id=') || href.includes('reply_comment_id=')) return false;
    return href.includes('/posts/') || href.includes('/pending_posts/') || href.includes('story_fbid=');
  }

  function firstPostLink(post) {
    const links = [];
    try { links.push(...xpathAll(selectors.postLink, post)); } catch {}
    try { links.push(...Array.from(post.querySelectorAll('a[href]')).filter(a => isPostPermalink(hrefOf(a)))); } catch {}
    for (const link of links) {
      const href = hrefOf(link);
      if (isPostPermalink(href)) return cleanPostHref(href);
    }
    return '';
  }

  async function resolvePostLink(post) {
    let rawPostLink = '';
    let postLink = firstPostLink(post);
    if (postLink) return { rawPostLink, postLink };

    let rawLinks = [];
    try { rawLinks.push(...xpathAll(selectors.rawPostLink, post)); } catch {}
    try { rawLinks.push(...Array.from(post.querySelectorAll('a[target="_blank"][href*="?__cft__"]'))); } catch {}
    rawLinks = rawLinks.slice(0, 5);
    for (const rawLinkEl of rawLinks) {
      const href = hrefOf(rawLinkEl);
      rawPostLink = rawPostLink || cleanPostHref(href);
      try { rawLinkEl.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true, view: window })); } catch {}
      await delay(450);
      postLink = firstPostLink(post);
      if (postLink) break;
    }
    return { rawPostLink, postLink };
  }

  function uniqueText(parts) {
    const seen = {};
    const out = [];
    for (const part of parts || []) {
      const text = String(part || '').replace(/\\s+/g, ' ').trim();
      if (!text || seen[text]) continue;
      seen[text] = 1;
      out.push(text);
    }
    return out;
  }

  const postElements = xpathAll(selectors.posts).filter(isVisible);
  const rows = [];

  for (let i = 0; i < postElements.length; i++) {
    const post = postElements[i];
    try {
      post.scrollIntoView({ block: 'center', inline: 'nearest' });
      await delay(300);
    } catch {}

    try {
      const seeMoreButtons = xpathAll(selectors.seeMore, post).filter(isVisible).slice(0, 5);
      for (const btn of seeMoreButtons) {
        clickSynthetic(btn);
        await delay(300);
      }
    } catch {}

    let contentParts = xpathAll(selectors.content, post)
      .map(el => (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim())
      .filter(Boolean);

    if (contentParts.length === 0) {
      contentParts = Array.from(post.querySelectorAll('[data-ad-rendering-role="message"], [data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"], [data-ad-preview="message"], [dir="auto"]'))
        .filter(isVisible)
        .map(el => (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim())
        .filter(Boolean);
    }

    let content = uniqueText(contentParts).join('\\n').trim();
    if (!content) content = (post.innerText || post.textContent || '').trim();
    const linkInfo = await resolvePostLink(post);

    rows.push({
      position: i + 1,
      content,
      rawPostLink: linkInfo.rawPostLink || '',
      postLink: linkInfo.postLink || ''
    });
  }

  return { posts: rows, count: postElements.length };
`

const result = []
const samples = []
const processedPostKeys = new Set()
let scannedCount = 0
let keywordMatchedCount = 0
let aiMatchedCount = 0
let skippedCount = 0
let failedCount = 0
let readCycles = 0
let scrollCycles = 0
let noGrowthCycles = 0
let lastVisiblePostCount = 0
let stopReason = ''

function getPostKey(post, position, rawText) {
  const linkKey = String(post && (post.postLink || post.rawPostLink) ? (post.postLink || post.rawPostLink) : '').trim()
  if (linkKey) return 'url:' + linkKey
  const textKey = normalizeForMatch(rawText).slice(0, 220)
  if (textKey) return 'text:' + textKey
  return 'position:' + position
}

async function processPost(post) {
  const rawText = String(post && post.content ? post.content : '')
  const normalizedText = normalizeForMatch(rawText)
  const position = Number(post && post.position ? post.position : scannedCount + 1)
  const key = getPostKey(post, position, rawText)
  if (processedPostKeys.has(key)) return false
  if (scannedCount >= MAX_SCANNED_POSTS) return false
  processedPostKeys.add(key)

  const postUrl = String(post && post.postLink ? post.postLink : '')
  const rawPostLink = String(post && post.rawPostLink ? post.rawPostLink : '')
  const postLinksForLog = postUrl ? [postUrl] : []
  scannedCount++

  if (samples.length < 3 && rawText) samples.push(rawText.replace(/\s+/g, ' ').trim().slice(0, 120))

  const contentMatches = !keywordEnabled || keywords.length === 0 || keywords.some(k => normalizedText.includes(k))
  if (keywordEnabled && contentMatches) keywordMatchedCount++

  if (!contentMatches) {
    skippedCount++
    await logPostSearchEvent({
      eventType: 'extract_post_data',
      eventName: 'Tìm bài post để comment',
      targetType: 'post',
      status: 'skipped',
      isUserVisible: true,
      itemIndex: position,
      targetUrl: postUrl,
      message: 'Không chứa keyword',
      extractedData: {
        entity: { type: 'post', url: postUrl, name: null, uid: null, contentText: rawText },
        filters: buildFilterData(false, createEmptyMeaningAiCheck()),
        values: { phones: [], zaloGroupLinks: [], postLinks: postLinksForLog, uids: [] }
      },
      debugData: { rawPostLink, postIndex: position, readCycles }
    })
    return true
  }

  const meaningAiCheck = await checkMeaningAi(rawText)
  const meaningAiAccepted = isMeaningAiAccepted(meaningAiCheck)
  if (aiEnabled && meaningAiAccepted) aiMatchedCount++

  if (!meaningAiAccepted) {
    if (isMeaningAiFailed(meaningAiCheck)) failedCount++
    else skippedCount++
    await logPostSearchEvent({
      eventType: 'extract_post_data',
      eventName: 'Tìm bài post để comment',
      targetType: 'post',
      status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped',
      isUserVisible: true,
      itemIndex: position,
      targetUrl: postUrl,
      message: getMeaningAiMessage(meaningAiCheck),
      extractedData: {
        entity: { type: 'post', url: postUrl, name: null, uid: null, contentText: rawText },
        filters: buildFilterData(contentMatches, meaningAiCheck),
        values: { phones: [], zaloGroupLinks: [], postLinks: postLinksForLog, uids: [] }
      },
      debugData: { rawPostLink, postIndex: position, readCycles }
    })
    return true
  }

  if (result.length < N) {
    const iterationIndex = result.length
    result.push({
      position,
      text: variants.length > 0 ? variants[iterationIndex % variants.length] : '',
      images: Array.isArray(imageBatches[iterationIndex]) ? imageBatches[iterationIndex] : [],
      postUrl
    })
    await logPostSearchEvent({
      eventType: 'extract_post_data',
      eventName: 'Tìm bài post để comment',
      targetType: 'post',
      status: 'success',
      isUserVisible: true,
      itemIndex: position,
      targetUrl: postUrl,
      message: 'Đã chọn bài post #' + position + ' để comment',
      extractedData: {
        entity: { type: 'post', url: postUrl, name: null, uid: null, contentText: rawText },
        filters: buildFilterData(contentMatches, meaningAiCheck),
        values: { phones: [], zaloGroupLinks: [], postLinks: postLinksForLog, uids: [] }
      },
      debugData: { rawPostLink, postIndex: position, selectedIndex: iterationIndex + 1, readCycles }
    })
  }

  return true
}

while (!(signal && signal.aborted) && result.length < N) {
  if (scannedCount >= MAX_SCANNED_POSTS) {
    stopReason = 'max_scanned_posts'
    break
  }
  if (noGrowthCycles >= MAX_NO_GROWTH_CYCLES) {
    stopReason = 'no_new_posts'
    break
  }

  // Một vòng = đọc batch DOM đang render. Chỉ khi chưa đủ bài mới cuộn tiếp.
  readCycles++
  let postData = { posts: [], count: 0 }
  try { postData = await page.evaluate(evalCode, selectors) } catch (e) {
    stopReason = 'read_error'
    helpers.log('⚠️ Lỗi đọc nội dung bài viết: ' + (e && e.message || e))
    break
  }

  const posts = Array.isArray(postData.posts) ? postData.posts : []
  lastVisiblePostCount = Number(postData.count || posts.length || 0)
  const beforeProcessedCount = processedPostKeys.size
  let hitScanCapInBatch = false

  for (const post of posts) {
    if (signal && signal.aborted) break
    // Không vượt quá tổng số bài đã quét, kể cả khi 1 batch DOM rất dài.
    if (scannedCount >= MAX_SCANNED_POSTS) {
      hitScanCapInBatch = true
      break
    }
    await processPost(post)
    if (result.length >= N) break
    if (scannedCount >= MAX_SCANNED_POSTS) {
      hitScanCapInBatch = true
      break
    }
  }

  const newPostCount = processedPostKeys.size - beforeProcessedCount
  helpers.log('🔍 Vòng tìm bài ' + readCycles + ': đọc ' + lastVisiblePostCount + ' bài đang thấy, thêm ' + newPostCount + ' bài mới, đã chọn ' + result.length + '/' + N)

  if (result.length >= N) {
    stopReason = 'enough_matches'
    break
  }
  if (signal && signal.aborted) {
    stopReason = 'cancelled'
    break
  }
  if (hitScanCapInBatch || scannedCount >= MAX_SCANNED_POSTS) {
    stopReason = 'max_scanned_posts'
    break
  }

  if (newPostCount <= 0) noGrowthCycles++
  else noGrowthCycles = 0

  if (noGrowthCycles >= MAX_NO_GROWTH_CYCLES) {
    stopReason = 'no_new_posts'
    break
  }

  // Dù feed cứ load bài mới mãi nhưng đều trượt keyword/AI thì vẫn chỉ cuộn tối đa 20 lần.
  // readCycles có thể là MAX_SCROLL_CYCLES + 1 vì batch đầu tiên đọc trước khi cuộn.
  if (scrollCycles >= MAX_SCROLL_CYCLES) {
    stopReason = 'max_scroll_cycles'
    break
  }

  try { await page.scroll({ direction: 'down', amount: 1500 }) } catch (e) {}
  scrollCycles++
  await helpers.sleep(2000, signal)
}

if (!stopReason) {
  if (signal && signal.aborted) stopReason = 'cancelled'
  else if (result.length >= N) stopReason = 'enough_matches'
  else if (scannedCount >= MAX_SCANNED_POSTS) stopReason = 'max_scanned_posts'
  else if (noGrowthCycles >= MAX_NO_GROWTH_CYCLES) stopReason = 'no_new_posts'
  else if (scrollCycles >= MAX_SCROLL_CYCLES) stopReason = 'max_scroll_cycles'
}

const reachedHardSearchLimit = result.length < N && (stopReason === 'max_scanned_posts' || stopReason === 'max_scroll_cycles')
const hardLimitLabel = stopReason === 'max_scanned_posts'
  ? 'đã chạm giới hạn quét ' + MAX_SCANNED_POSTS + ' bài'
  : stopReason === 'max_scroll_cycles'
    ? 'đã chạm giới hạn cuộn ' + MAX_SCROLL_CYCLES + ' vòng'
    : ''
const hardLimitMessage = reachedHardSearchLimit
  ? 'Đã quét ' + scannedCount + ' bài / ' + scrollCycles + ' vòng cuộn, chỉ chọn được ' + result.length + '/' + N + ' bài phù hợp (' + hardLimitLabel + ').'
  : ''

if (reachedHardSearchLimit) {
  // Báo rõ lý do thiếu bài kể cả đã chọn được một phần, để user không nghĩ workflow bị kẹt.
  helpers.log('⚠️ ' + hardLimitMessage)
  if (result.length === 0 && hasSearchConditions && samples.length > 0) {
    helpers.log('ℹ️ Nội dung đã đọc thử: ' + samples.join(' | '))
  }
  if (result.length > 0) {
    helpers.log('📋 Sẽ comment vào ' + result.length + '/' + N + ' bài' + (hasSearchConditions ? ' theo điều kiện tìm kiếm bài post' : ''))
  }
} else if (result.length === 0) {
  if (scannedCount === 0) {
    helpers.log('⚠️ Không tìm thấy bài viết nào. Tài khoản có thể chưa được duyệt vào nhóm hoặc trang chưa load xong.')
  } else if (hasSearchConditions) {
    helpers.log('⚠️ Có ' + scannedCount + ' bài viết đã quét nhưng không khớp điều kiện tìm kiếm bài post')
    if (samples.length > 0) helpers.log('ℹ️ Nội dung đã đọc thử: ' + samples.join(' | '))
  } else {
    helpers.log('⚠️ Chưa chuẩn bị được danh sách bài để comment')
  }
} else {
  helpers.log('📋 Sẽ comment vào ' + result.length + '/' + N + ' bài' + (hasSearchConditions ? ' theo điều kiện tìm kiếm bài post' : ''))
}

const summaryMessage = hardLimitMessage || ('Đã chọn ' + result.length + '/' + N + ' bài phù hợp từ ' + scannedCount + ' bài đã quét')

await logPostSearchEvent({
  eventType: 'comment_seeding_post_search_summary',
  eventName: 'Tổng kết tìm bài post',
  targetType: 'summary',
  status: 'success',
  isUserVisible: true,
  elementCount: result.length,
  message: summaryMessage,
  extractedData: {
    entity: { type: 'summary', url: '', name: String(vars.inputDataName || vars.campaignInputDataName || ''), uid: null, contentText: summaryMessage },
    filters: buildFilterData(keywordEnabled ? result.length > 0 : null, createEmptyMeaningAiCheck()),
    values: { phones: [], zaloGroupLinks: [], postLinks: unique(result.map(item => item.postUrl)), uids: [] }
  },
  debugData: {
    requestedCount: N,
    visiblePostCount: lastVisiblePostCount,
    scannedCount,
    matchedCount: result.length,
    readCycles,
    scrollCycles,
    noGrowthCycles,
    stopReason,
    maxScannedPosts: MAX_SCANNED_POSTS,
    maxScrollCycles: MAX_SCROLL_CYCLES,
    maxNoGrowthCycles: MAX_NO_GROWTH_CYCLES,
    hardLimitReached: reachedHardSearchLimit,
    keywordMatchedCount,
    aiMatchedCount,
    skippedCount,
    failedCount,
    keywordEnabled,
    aiEnabled
  }
})

return {
  commentIterations: result,
  totalCount: scannedCount,
  matchedCount: result.length,
  scannedCount,
  readCycles,
  scrollCycles,
  noGrowthCycles,
  stopReason,
  maxScannedPosts: MAX_SCANNED_POSTS,
  maxScrollCycles: MAX_SCROLL_CYCLES,
  maxNoGrowthCycles: MAX_NO_GROWTH_CYCLES,
  hardLimitReached: reachedHardSearchLimit,
  keywordMatchedCount,
  aiMatchedCount,
  skippedCount,
  failedCount
}
$v641$, updated_at = now()
 WHERE id = 2859 AND md5(code) = '81f1dd79e70bbafcb85cf98b2d672210';

UPDATE public.auto_blocks SET code = $v641$// Centralized AI find-data filter via ai_using.
const __aiFindDataUsingCode = "fb_extract_data_from_group_posts_ai_filter";
const __extractAIText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (Array.isArray(value)) return value.map(__extractAIText).filter(Boolean).join('\n').trim();
  if (typeof value === 'object') {
    const data = value;
    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result;
    if (direct !== undefined && direct !== null && direct !== value) {
      const directText = __extractAIText(direct);
      if (directText) return directText;
    }
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value || '').trim();
};
const __callCentralAI = async (usingCode, payload) => {
  if (!usingCode) throw new Error('Thiếu mã cấu hình AI');
  if (typeof helpers.callAIUsing !== 'function') throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  const result = await helpers.callAIUsing(usingCode, payload || {});
  if (result && result.unsupported) throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : 'AI lỗi'));
  return result;
};
const __splitMeaningTraits = (prompt) => {
  const lines = String(prompt || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [String(prompt || '').trim()].filter(Boolean);
};
const __extractJsonText = (raw) => {
  const trimmed = String(raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : trimmed).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
};
const checkMeaningAI = async (options = {}) => {
  const prompt = String(options.prompt || '').trim();
  const contentText = String(options.contentText || '').trim();
  const entityType = String(options.entityType || 'content').trim() || 'content';
  const traits = __splitMeaningTraits(prompt);
  const criteria = traits.map((trait, index) => (index + 1) + '. ' + trait).join('\n');
  const result = await __callCentralAI(__aiFindDataUsingCode, {
    prompt,
    criteria,
    entity_type: entityType,
    entityType,
    content: JSON.stringify(contentText),
    contentText
  });
  const rawResult = __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));
  let matched = false;
  let reason = '';
  try {
    const parsed = JSON.parse(__extractJsonText(rawResult));
    matched = parsed.matched === true || parsed.match === true || String(parsed.result || parsed.checkResult || '').toLowerCase() === 'matched';
    reason = String(parsed.reason || parsed.explanation || parsed.message || '').trim();
  } catch {
    const normalized = rawResult.toLowerCase();
    matched = normalized.includes('matched') || normalized.includes('true') || normalized.includes('phù hợp') || normalized.includes('phu hop') || normalized.includes('có');
    reason = rawResult.slice(0, 500);
  }
  return {
    ok: true,
    matched,
    checkResult: matched ? 'matched' : 'not_matched',
    prompt,
    finalPrompt: String(result.renderedUserPrompt || result.rendered_user_prompt || ''),
    rawResult,
    reason,
    provider: result.provider || '',
    model: result.model || ''
  };
};


function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') {
    vars.findDataResults = {};
  }
  const results = vars.findDataResults;
  if (!Array.isArray(results.phones)) results.phones = [];
  if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = [];
  if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.uidProfiles)) results.uidProfiles = [];
  if (!Array.isArray(results.phoneProfiles)) results.phoneProfiles = [];
  if (!Array.isArray(results.postLinks)) results.postLinks = [];
  if (!Array.isArray(results.groupMembers)) results.groupMembers = [];
  if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
  if (!results.sourceData.post || typeof results.sourceData.post !== 'object') results.sourceData.post = {};
  if (!Array.isArray(results.sourceData.post.phones)) results.sourceData.post.phones = [];
  if (!Array.isArray(results.sourceData.post.linkGroupZalos)) results.sourceData.post.linkGroupZalos = [];
  if (!Array.isArray(results.sourceData.post.uids)) results.sourceData.post.uids = [];
  if (!Array.isArray(results.sourceData.post.postLinks)) results.sourceData.post.postLinks = [];
  if (!results.sourceData.newInteractors || typeof results.sourceData.newInteractors !== 'object') results.sourceData.newInteractors = {};
  if (!Array.isArray(results.sourceData.newInteractors.uids)) results.sourceData.newInteractors.uids = [];
  return results;
}

function normalizeKeywordText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
function keywordList() {
  return String(vars.postKeywords || '')
    .split(',')
    .map(x => normalizeKeywordText(x.trim()))
    .filter(Boolean);
}

function matchesContent(text) {
  if (!vars.isFindPostByKeywords) return true;
  const words = keywordList();
  if (words.length === 0) return true;
  const haystack = normalizeKeywordText(text);
  return words.some(word => haystack.includes(word));
}

function isMeaningAiEnabled() {
  return vars.isFindPostByContentAI === true && String(vars.postContentAI || '').trim().length > 0;
}

function createEmptyMeaningAiCheck() {
  return {
    ok: true,
    matched: true,
    checkResult: '',
    prompt: String(vars.postContentAI || ''),
    finalPrompt: '',
    rawResult: '',
    reason: '',
    error: ''
  };
}

function normalizeMeaningAiCheck(result) {
  if (result && result.unsupported) {
    return {
      ok: false,
      matched: false,
      checkResult: 'error',
      prompt: String(vars.postContentAI || ''),
      finalPrompt: '',
      rawResult: '',
      reason: 'Runtime chưa hỗ trợ helper callAIUsing',
      error: 'Runtime chưa hỗ trợ helper callAIUsing'
    };
  }
  const raw = result && typeof result === 'object' ? result : {};
  const checkResult = String(raw.checkResult || raw.check_result || (raw.ok === true ? (raw.matched === true ? 'matched' : 'not_matched') : 'error'));
  return {
    ok: raw.ok === true,
    matched: raw.matched === true,
    checkResult,
    prompt: String(raw.prompt || vars.postContentAI || ''),
    finalPrompt: String(raw.finalPrompt || raw.final_prompt || ''),
    rawResult: String(raw.rawResult || raw.raw_result || ''),
    reason: String(raw.reason || raw.error || ''),
    error: String(raw.error || '')
  };
}

async function checkMeaningAi(content, entityType) {
  if (!isMeaningAiEnabled()) return createEmptyMeaningAiCheck();
  const result = await checkMeaningAI({
    contentText: String(content || ''),
    prompt: String(vars.postContentAI || ''),
    entityType
  });
  return normalizeMeaningAiCheck(result);
}

function isMeaningAiAccepted(aiCheck) {
  return !isMeaningAiEnabled() || (aiCheck && aiCheck.ok === true && aiCheck.matched === true);
}

function isMeaningAiFailed(aiCheck) {
  return isMeaningAiEnabled() && (!aiCheck || aiCheck.ok !== true);
}

function getMeaningAiMessage(aiCheck) {
  if (isMeaningAiFailed(aiCheck)) return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân');
  if (isMeaningAiEnabled() && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI';
  return 'Đúng ý nghĩa AI';
}

function buildFilterData(matchedKeyword, aiCheck) {
  const keywordEnabled = vars.isFindPostByKeywords === true && String(vars.postKeywords || '').trim().length > 0;
  const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : '');
  const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : '');
  return {
    keywordEnabled,
    keyword: keywordEnabled ? String(vars.postKeywords || '') : null,
    matchedKeyword: keywordEnabled ? matchedKeyword : null,
    aiPrompt: String(vars.postContentAI || '') || null,
    aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''),
    aiRawResult: rawResult,
    aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''),
    aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null,
    aiReason: reason || null,
    aiResult: rawResult || null
  };
}


function normalizePhone(value) {
  const raw = String(value || '').trim();
  const compact = raw.replace(/[\s.\-]/g, '');
  let digits = compact.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  if (/^0[35789]\d{8}$/.test(digits)) return digits;
  return '';
}

function findPhones(text) {
  const matches = String(text || '').match(/(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}\b/g) || [];
  return matches.map(normalizePhone).filter(Boolean);
}

function findZaloLinks(text) {
  const matches = String(text || '').match(/(?:https?:\/\/)?zalo\.me\/g\/[a-z0-9]+/gi) || [];
  return matches.map(x => x.trim()).filter(Boolean);
}

function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

function authorUidFromItem(item) {
  const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim();
  const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim();

  try {
    const url = new URL(rawHref, 'https://www.facebook.com');
    const parts = url.pathname
      .split('/')
      .map(part => {
        try { return decodeURIComponent(part); } catch { return part; }
      })
      .map(part => part.trim())
      .filter(Boolean);
    const lowerParts = parts.map(part => part.toLowerCase());
    const firstPathPart = lowerParts[0] || '';

    if (firstPathPart === 'profile.php') {
      const id = url.searchParams.get('id');
      return id ? id.trim() : '';
    }

    const userIndex = lowerParts.indexOf('user');
    if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];

    if (firstPathPart === 'groups') return '';

    const blockedPathParts = new Set(['posts', 'permalink', 'permalink.php', 'story.php', 'photo.php', 'photos', 'watch', 'reel', 'videos', 'video.php']);
    if (lowerParts.some(part => blockedPathParts.has(part))) return '';

    if (parts.length === 1 && parts[0]) return parts[0];
  } catch {}

  return fallbackUid;
}

const results = ensureResults();
const sourcePost = results.sourceData.post;
const sourceNewInteractors = results.sourceData.newInteractors;
const posts = Array.isArray(input.posts) ? input.posts : (Array.isArray(vars.findDataPosts) ? vars.findDataPosts : []);

let matchedPosts = 0;
const postFilterEnabled = (
  vars.isFindPostByKeywords === true && String(vars.postKeywords || '').trim().length > 0
) || (
  vars.isFindPostByContentAI === true && String(vars.postContentAI || '').trim().length > 0
);
const matchedPostIndexes = [];
vars.findDataPostFilterEnabled = postFilterEnabled;
vars.findDataMatchedPostIndexes = [];


if (vars.isFindInPost || vars.isFindInComment || vars.isFindPostLink || vars.isFindNewInteractors) {
  for (let postLoopIndex = 0; postLoopIndex < posts.length; postLoopIndex++) {
    const post = posts[postLoopIndex];
    const content = String(post && post.content ? post.content : '');
    const postIndexForFilter = Math.max(1, Number(post && post.index ? post.index : postLoopIndex + 1));
    const contentMatches = matchesContent(content);
    const shouldExtractPostData = vars.isFindInPost || vars.isFindPostLink;
    const shouldFilterPostForComments = vars.isFindInComment === true && postFilterEnabled;
    const shouldEvaluatePostContent = shouldExtractPostData || shouldFilterPostForComments;
    const meaningAiCheck = shouldEvaluatePostContent && contentMatches ? await checkMeaningAi(content, 'post') : createEmptyMeaningAiCheck();
    const meaningAiAccepted = isMeaningAiAccepted(meaningAiCheck);
    const postAuthorUidForLog = authorUidFromItem(post);
    const postAuthorNameForLog = String(post && post.authorName ? post.authorName : '').trim();
    const postPhonesForLog = findPhones(content);
    const postZaloLinksForLog = findZaloLinks(content);
    const postLinksForLog = post && post.postLink ? [String(post.postLink)] : [];

    if (shouldEvaluatePostContent && !contentMatches) {
      await helpers.logRunEvent({
        eventType: 'extract_post_data',
        eventName: 'Lấy thông tin bài post',
        targetType: 'post',
        status: 'skipped',
        isUserVisible: true,
        itemIndex: post && post.index ? post.index : null,
        targetUrl: String(post && post.postLink ? post.postLink : ''),
        message: 'Không chứa keyword',
        extractedData: {
          entity: {
            type: 'post',
            url: String(post && post.postLink ? post.postLink : ''),
            name: postAuthorNameForLog || null,
            uid: postAuthorUidForLog || null,
            contentText: content
          },
          filters: buildFilterData(false, createEmptyMeaningAiCheck()),
          values: {
            phones: postPhonesForLog,
            zaloGroupLinks: postZaloLinksForLog,
            postLinks: postLinksForLog,
            uids: unique([postAuthorUidForLog].filter(Boolean))
          }
        },
        debugData: {
          postIndex: post && post.index ? post.index : null,
          authorName: postAuthorNameForLog,
          authorUrl: String(post && post.authorUrl ? post.authorUrl : ''),
          rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : '')
        }
      });
    }

    if (shouldEvaluatePostContent && contentMatches && !meaningAiAccepted) {
      await helpers.logRunEvent({
        eventType: 'extract_post_data',
        eventName: 'Lấy thông tin bài post',
        targetType: 'post',
        status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped',
        isUserVisible: true,
        itemIndex: post && post.index ? post.index : null,
        targetUrl: String(post && post.postLink ? post.postLink : ''),
        message: getMeaningAiMessage(meaningAiCheck),
        extractedData: {
          entity: {
            type: 'post',
            url: String(post && post.postLink ? post.postLink : ''),
            name: postAuthorNameForLog || null,
            uid: postAuthorUidForLog || null,
            contentText: content
          },
          filters: buildFilterData(true, meaningAiCheck),
          values: {
            phones: postPhonesForLog,
            zaloGroupLinks: postZaloLinksForLog,
            postLinks: postLinksForLog,
            uids: unique([postAuthorUidForLog].filter(Boolean))
          }
        },
        debugData: {
          postIndex: post && post.index ? post.index : null,
          authorName: postAuthorNameForLog,
          authorUrl: String(post && post.authorUrl ? post.authorUrl : ''),
          rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : '')
        }
      });
    }

    if (shouldEvaluatePostContent && contentMatches && meaningAiAccepted) {
      matchedPosts++;
      if (postFilterEnabled) matchedPostIndexes.push(postIndexForFilter);

      if (vars.isFindInPost && vars.isFindPhone) {
        const phones = findPhones(content);
        results.phones.push(...phones);
        sourcePost.phones.push(...phones);
        for (const phone of phones) {
          results.phoneProfiles.push({
            phone,
            name: postAuthorNameForLog,
            uid: authorUidFromItem(post),
            url: String(post && post.authorUrl ? post.authorUrl : ''),
            source: 'post'
          });
        }
      }
      if (vars.isFindInPost && vars.isFindLinkGroupZalo) {
        const linkGroupZalos = findZaloLinks(content);
        results.linkGroupZalos.push(...linkGroupZalos);
        sourcePost.linkGroupZalos.push(...linkGroupZalos);
      }
      const authorUid = authorUidFromItem(post);
      if (vars.isFindInPost && vars.isFindUid && authorUid) {
        results.uids.push(authorUid);
        sourcePost.uids.push(authorUid);
        results.uidProfiles.push({
          uid: authorUid,
          name: postAuthorNameForLog,
          url: String(post && post.authorUrl ? post.authorUrl : ''),
          source: 'post'
        });
      }
      if (vars.isFindPostLink && post && post.postLink) {
        results.postLinks.push(String(post.postLink));
        sourcePost.postLinks.push(String(post.postLink));
      }
    }
    const newInteractorUid = authorUidFromItem(post);
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
      results.uidProfiles.push({
        uid: newInteractorUid,
        name: postAuthorNameForLog,
        url: String(post && post.authorUrl ? post.authorUrl : ''),
        source: 'new_interactor'
      });
    }
    const shouldLogPostExtract = (shouldEvaluatePostContent && contentMatches && meaningAiAccepted) || (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid);
    if (shouldLogPostExtract) {
      await helpers.logRunEvent({
        eventType: 'extract_post_data',
        eventName: 'Lấy thông tin bài post',
        targetType: 'post',
        status: 'success',
        isUserVisible: true,
        itemIndex: post && post.index ? post.index : null,
        targetUrl: String(post && post.postLink ? post.postLink : ''),
        message: 'Đã duyệt bài viết' + (post && post.index ? ' #' + post.index : ''),
        extractedData: {
          entity: {
            type: 'post',
            url: String(post && post.postLink ? post.postLink : ''),
            name: postAuthorNameForLog || null,
            uid: postAuthorUidForLog || newInteractorUid || null,
            contentText: content
          },
          filters: buildFilterData(contentMatches, meaningAiCheck),
          values: {
            phones: postPhonesForLog,
            zaloGroupLinks: postZaloLinksForLog,
            postLinks: postLinksForLog,
            uids: unique([postAuthorUidForLog, newInteractorUid].filter(Boolean))
          }
        },
        debugData: {
          postIndex: post && post.index ? post.index : null,
          authorName: postAuthorNameForLog,
          authorUrl: String(post && post.authorUrl ? post.authorUrl : ''),
          rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : ''),
          source: vars.isFindNewInteractors ? 'new_interactors_or_post' : 'post'
        }
      });
    }
  }
}

results.phones = unique(results.phones);
results.linkGroupZalos = unique(results.linkGroupZalos);
results.uids = unique(results.uids);
results.postLinks = unique(results.postLinks);
sourcePost.phones = unique(sourcePost.phones);
sourcePost.linkGroupZalos = unique(sourcePost.linkGroupZalos);
sourcePost.uids = unique(sourcePost.uids);
sourcePost.postLinks = unique(sourcePost.postLinks);
sourceNewInteractors.uids = unique(sourceNewInteractors.uids);

vars.findDataMatchedPostIndexes = unique(matchedPostIndexes);
vars.findDataPostFilterEnabled = postFilterEnabled;

return {
  matchedPosts,
  phones: results.phones,
  linkGroupZalos: results.linkGroupZalos,
  uids: results.uids,
  postLinks: results.postLinks,
  sourceCounts: {
    post: {
      phones: sourcePost.phones.length,
      linkGroupZalos: sourcePost.linkGroupZalos.length,
      uids: sourcePost.uids.length,
      postLinks: sourcePost.postLinks.length
    },
    newInteractors: {
      uids: sourceNewInteractors.uids.length
    }
  }
};
$v641$, updated_at = now()
 WHERE id = 2602 AND md5(code) = '1716cf0e653949d72decaf6b7b633d15';

UPDATE public.auto_blocks SET code = $v641$// Centralized AI find-data filter via ai_using.
const __aiFindDataUsingCode = "fb_extract_data_from_group_posts_ai_filter";
const __extractAIText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (Array.isArray(value)) return value.map(__extractAIText).filter(Boolean).join('\n').trim();
  if (typeof value === 'object') {
    const data = value;
    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result;
    if (direct !== undefined && direct !== null && direct !== value) {
      const directText = __extractAIText(direct);
      if (directText) return directText;
    }
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value || '').trim();
};
const __callCentralAI = async (usingCode, payload) => {
  if (!usingCode) throw new Error('Thiếu mã cấu hình AI');
  if (typeof helpers.callAIUsing !== 'function') throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  const result = await helpers.callAIUsing(usingCode, payload || {});
  if (result && result.unsupported) throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : 'AI lỗi'));
  return result;
};
const __splitMeaningTraits = (prompt) => {
  const lines = String(prompt || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [String(prompt || '').trim()].filter(Boolean);
};
const __extractJsonText = (raw) => {
  const trimmed = String(raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : trimmed).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
};
const checkMeaningAI = async (options = {}) => {
  const prompt = String(options.prompt || '').trim();
  const contentText = String(options.contentText || '').trim();
  const entityType = String(options.entityType || 'content').trim() || 'content';
  const traits = __splitMeaningTraits(prompt);
  const criteria = traits.map((trait, index) => (index + 1) + '. ' + trait).join('\n');
  const result = await __callCentralAI(__aiFindDataUsingCode, {
    prompt,
    criteria,
    entity_type: entityType,
    entityType,
    content: JSON.stringify(contentText),
    contentText
  });
  const rawResult = __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));
  let matched = false;
  let reason = '';
  try {
    const parsed = JSON.parse(__extractJsonText(rawResult));
    matched = parsed.matched === true || parsed.match === true || String(parsed.result || parsed.checkResult || '').toLowerCase() === 'matched';
    reason = String(parsed.reason || parsed.explanation || parsed.message || '').trim();
  } catch {
    const normalized = rawResult.toLowerCase();
    matched = normalized.includes('matched') || normalized.includes('true') || normalized.includes('phù hợp') || normalized.includes('phu hop') || normalized.includes('có');
    reason = rawResult.slice(0, 500);
  }
  return {
    ok: true,
    matched,
    checkResult: matched ? 'matched' : 'not_matched',
    prompt,
    finalPrompt: String(result.renderedUserPrompt || result.rendered_user_prompt || ''),
    rawResult,
    reason,
    provider: result.provider || '',
    model: result.model || ''
  };
};


function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') {
    vars.findDataResults = {};
  }
  const results = vars.findDataResults;
  if (!Array.isArray(results.phones)) results.phones = [];
  if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = [];
  if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.uidProfiles)) results.uidProfiles = [];
  if (!Array.isArray(results.phoneProfiles)) results.phoneProfiles = [];
  if (!Array.isArray(results.postLinks)) results.postLinks = [];
  if (!Array.isArray(results.groupMembers)) results.groupMembers = [];
  if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
  if (!results.sourceData.post || typeof results.sourceData.post !== 'object') results.sourceData.post = {};
  if (!Array.isArray(results.sourceData.post.phones)) results.sourceData.post.phones = [];
  if (!Array.isArray(results.sourceData.post.linkGroupZalos)) results.sourceData.post.linkGroupZalos = [];
  if (!Array.isArray(results.sourceData.post.uids)) results.sourceData.post.uids = [];
  if (!Array.isArray(results.sourceData.post.postLinks)) results.sourceData.post.postLinks = [];
  if (!results.sourceData.newInteractors || typeof results.sourceData.newInteractors !== 'object') results.sourceData.newInteractors = {};
  if (!Array.isArray(results.sourceData.newInteractors.uids)) results.sourceData.newInteractors.uids = [];
  return results;
}

function normalizeKeywordText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
function keywordList() {
  return String(vars.postKeywords || '')
    .split(',')
    .map(x => normalizeKeywordText(x.trim()))
    .filter(Boolean);
}

function matchesContent(text) {
  if (!vars.isFindPostByKeywords) return true;
  const words = keywordList();
  if (words.length === 0) return true;
  const haystack = normalizeKeywordText(text);
  return words.some(word => haystack.includes(word));
}

function isMeaningAiEnabled() {
  return vars.isFindPostByContentAI === true && String(vars.postContentAI || '').trim().length > 0;
}

function createEmptyMeaningAiCheck() {
  return {
    ok: true,
    matched: true,
    checkResult: '',
    prompt: String(vars.postContentAI || ''),
    finalPrompt: '',
    rawResult: '',
    reason: '',
    error: ''
  };
}

function normalizeMeaningAiCheck(result) {
  if (result && result.unsupported) {
    return {
      ok: false,
      matched: false,
      checkResult: 'error',
      prompt: String(vars.postContentAI || ''),
      finalPrompt: '',
      rawResult: '',
      reason: 'Runtime chưa hỗ trợ helper callAIUsing',
      error: 'Runtime chưa hỗ trợ helper callAIUsing'
    };
  }
  const raw = result && typeof result === 'object' ? result : {};
  const checkResult = String(raw.checkResult || raw.check_result || (raw.ok === true ? (raw.matched === true ? 'matched' : 'not_matched') : 'error'));
  return {
    ok: raw.ok === true,
    matched: raw.matched === true,
    checkResult,
    prompt: String(raw.prompt || vars.postContentAI || ''),
    finalPrompt: String(raw.finalPrompt || raw.final_prompt || ''),
    rawResult: String(raw.rawResult || raw.raw_result || ''),
    reason: String(raw.reason || raw.error || ''),
    error: String(raw.error || '')
  };
}

async function checkMeaningAi(content, entityType) {
  if (!isMeaningAiEnabled()) return createEmptyMeaningAiCheck();
  const result = await checkMeaningAI({
    contentText: String(content || ''),
    prompt: String(vars.postContentAI || ''),
    entityType
  });
  return normalizeMeaningAiCheck(result);
}

function isMeaningAiAccepted(aiCheck) {
  return !isMeaningAiEnabled() || (aiCheck && aiCheck.ok === true && aiCheck.matched === true);
}

function isMeaningAiFailed(aiCheck) {
  return isMeaningAiEnabled() && (!aiCheck || aiCheck.ok !== true);
}

function getMeaningAiMessage(aiCheck) {
  if (isMeaningAiFailed(aiCheck)) return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân');
  if (isMeaningAiEnabled() && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI';
  return 'Đúng ý nghĩa AI';
}

function buildFilterData(matchedKeyword, aiCheck) {
  const keywordEnabled = vars.isFindPostByKeywords === true && String(vars.postKeywords || '').trim().length > 0;
  const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : '');
  const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : '');
  return {
    keywordEnabled,
    keyword: keywordEnabled ? String(vars.postKeywords || '') : null,
    matchedKeyword: keywordEnabled ? matchedKeyword : null,
    aiPrompt: String(vars.postContentAI || '') || null,
    aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''),
    aiRawResult: rawResult,
    aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''),
    aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null,
    aiReason: reason || null,
    aiResult: rawResult || null
  };
}


function normalizePhone(value) {
  const raw = String(value || '').trim();
  const compact = raw.replace(/[\s.\-]/g, '');
  let digits = compact.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  if (/^0[35789]\d{8}$/.test(digits)) return digits;
  return '';
}

function findPhones(text) {
  const matches = String(text || '').match(/(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}\b/g) || [];
  return matches.map(normalizePhone).filter(Boolean);
}

function findZaloLinks(text) {
  const matches = String(text || '').match(/(?:https?:\/\/)?zalo\.me\/g\/[a-z0-9]+/gi) || [];
  return matches.map(x => x.trim()).filter(Boolean);
}

function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

function authorUidFromItem(item) {
  const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim();
  const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim();

  try {
    const url = new URL(rawHref, 'https://www.facebook.com');
    const parts = url.pathname
      .split('/')
      .map(part => {
        try { return decodeURIComponent(part); } catch { return part; }
      })
      .map(part => part.trim())
      .filter(Boolean);
    const lowerParts = parts.map(part => part.toLowerCase());
    const firstPathPart = lowerParts[0] || '';

    if (firstPathPart === 'profile.php') {
      const id = url.searchParams.get('id');
      return id ? id.trim() : '';
    }

    const userIndex = lowerParts.indexOf('user');
    if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];

    if (firstPathPart === 'groups') return '';

    const blockedPathParts = new Set(['posts', 'permalink', 'permalink.php', 'story.php', 'photo.php', 'photos', 'watch', 'reel', 'videos', 'video.php']);
    if (lowerParts.some(part => blockedPathParts.has(part))) return '';

    if (parts.length === 1 && parts[0]) return parts[0];
  } catch {}

  return fallbackUid;
}

const results = ensureResults();
const sourcePost = results.sourceData.post;
const sourceNewInteractors = results.sourceData.newInteractors;
const posts = Array.isArray(input.posts) ? input.posts : (Array.isArray(vars.findDataPosts) ? vars.findDataPosts : []);

let matchedPosts = 0;
const postFilterEnabled = (
  vars.isFindPostByKeywords === true && String(vars.postKeywords || '').trim().length > 0
) || (
  vars.isFindPostByContentAI === true && String(vars.postContentAI || '').trim().length > 0
);
const matchedPostIndexes = [];
vars.findDataPostFilterEnabled = postFilterEnabled;
vars.findDataMatchedPostIndexes = [];


if (vars.isFindInPost || vars.isFindInComment || vars.isFindPostLink || vars.isFindNewInteractors) {
  for (let postLoopIndex = 0; postLoopIndex < posts.length; postLoopIndex++) {
    const post = posts[postLoopIndex];
    const content = String(post && post.content ? post.content : '');
    const postIndexForFilter = Math.max(1, Number(post && post.index ? post.index : postLoopIndex + 1));
    const contentMatches = matchesContent(content);
    const shouldExtractPostData = vars.isFindInPost || vars.isFindPostLink;
    const shouldFilterPostForComments = vars.isFindInComment === true && postFilterEnabled;
    const shouldEvaluatePostContent = shouldExtractPostData || shouldFilterPostForComments;
    const meaningAiCheck = shouldEvaluatePostContent && contentMatches ? await checkMeaningAi(content, 'post') : createEmptyMeaningAiCheck();
    const meaningAiAccepted = isMeaningAiAccepted(meaningAiCheck);
    const postAuthorUidForLog = authorUidFromItem(post);
    const postAuthorNameForLog = String(post && post.authorName ? post.authorName : '').trim();
    const postPhonesForLog = findPhones(content);
    const postZaloLinksForLog = findZaloLinks(content);
    const postLinksForLog = post && post.postLink ? [String(post.postLink)] : [];

    if (shouldEvaluatePostContent && !contentMatches) {
      await helpers.logRunEvent({
        eventType: 'extract_post_data',
        eventName: 'Lấy thông tin bài post',
        targetType: 'post',
        status: 'skipped',
        isUserVisible: true,
        itemIndex: post && post.index ? post.index : null,
        targetUrl: String(post && post.postLink ? post.postLink : ''),
        message: 'Không chứa keyword',
        extractedData: {
          entity: {
            type: 'post',
            url: String(post && post.postLink ? post.postLink : ''),
            name: postAuthorNameForLog || null,
            uid: postAuthorUidForLog || null,
            contentText: content
          },
          filters: buildFilterData(false, createEmptyMeaningAiCheck()),
          values: {
            phones: postPhonesForLog,
            zaloGroupLinks: postZaloLinksForLog,
            postLinks: postLinksForLog,
            uids: unique([postAuthorUidForLog].filter(Boolean))
          }
        },
        debugData: {
          postIndex: post && post.index ? post.index : null,
          authorName: postAuthorNameForLog,
          authorUrl: String(post && post.authorUrl ? post.authorUrl : ''),
          rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : '')
        }
      });
    }

    if (shouldEvaluatePostContent && contentMatches && !meaningAiAccepted) {
      await helpers.logRunEvent({
        eventType: 'extract_post_data',
        eventName: 'Lấy thông tin bài post',
        targetType: 'post',
        status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped',
        isUserVisible: true,
        itemIndex: post && post.index ? post.index : null,
        targetUrl: String(post && post.postLink ? post.postLink : ''),
        message: getMeaningAiMessage(meaningAiCheck),
        extractedData: {
          entity: {
            type: 'post',
            url: String(post && post.postLink ? post.postLink : ''),
            name: postAuthorNameForLog || null,
            uid: postAuthorUidForLog || null,
            contentText: content
          },
          filters: buildFilterData(true, meaningAiCheck),
          values: {
            phones: postPhonesForLog,
            zaloGroupLinks: postZaloLinksForLog,
            postLinks: postLinksForLog,
            uids: unique([postAuthorUidForLog].filter(Boolean))
          }
        },
        debugData: {
          postIndex: post && post.index ? post.index : null,
          authorName: postAuthorNameForLog,
          authorUrl: String(post && post.authorUrl ? post.authorUrl : ''),
          rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : '')
        }
      });
    }

    if (shouldEvaluatePostContent && contentMatches && meaningAiAccepted) {
      matchedPosts++;
      if (postFilterEnabled) matchedPostIndexes.push(postIndexForFilter);

      if (vars.isFindInPost && vars.isFindPhone) {
        const phones = findPhones(content);
        results.phones.push(...phones);
        sourcePost.phones.push(...phones);
        for (const phone of phones) {
          results.phoneProfiles.push({
            phone,
            name: postAuthorNameForLog,
            uid: authorUidFromItem(post),
            url: String(post && post.authorUrl ? post.authorUrl : ''),
            source: 'post'
          });
        }
      }
      if (vars.isFindInPost && vars.isFindLinkGroupZalo) {
        const linkGroupZalos = findZaloLinks(content);
        results.linkGroupZalos.push(...linkGroupZalos);
        sourcePost.linkGroupZalos.push(...linkGroupZalos);
      }
      const authorUid = authorUidFromItem(post);
      if (vars.isFindInPost && vars.isFindUid && authorUid) {
        results.uids.push(authorUid);
        sourcePost.uids.push(authorUid);
        results.uidProfiles.push({
          uid: authorUid,
          name: postAuthorNameForLog,
          url: String(post && post.authorUrl ? post.authorUrl : ''),
          source: 'post'
        });
      }
      if (vars.isFindPostLink && post && post.postLink) {
        results.postLinks.push(String(post.postLink));
        sourcePost.postLinks.push(String(post.postLink));
      }
    }
    const newInteractorUid = authorUidFromItem(post);
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
      results.uidProfiles.push({
        uid: newInteractorUid,
        name: postAuthorNameForLog,
        url: String(post && post.authorUrl ? post.authorUrl : ''),
        source: 'new_interactor'
      });
    }
    const shouldLogPostExtract = (shouldEvaluatePostContent && contentMatches && meaningAiAccepted) || (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid);
    if (shouldLogPostExtract) {
      await helpers.logRunEvent({
        eventType: 'extract_post_data',
        eventName: 'Lấy thông tin bài post',
        targetType: 'post',
        status: 'success',
        isUserVisible: true,
        itemIndex: post && post.index ? post.index : null,
        targetUrl: String(post && post.postLink ? post.postLink : ''),
        message: 'Đã duyệt bài viết' + (post && post.index ? ' #' + post.index : ''),
        extractedData: {
          entity: {
            type: 'post',
            url: String(post && post.postLink ? post.postLink : ''),
            name: postAuthorNameForLog || null,
            uid: postAuthorUidForLog || newInteractorUid || null,
            contentText: content
          },
          filters: buildFilterData(contentMatches, meaningAiCheck),
          values: {
            phones: postPhonesForLog,
            zaloGroupLinks: postZaloLinksForLog,
            postLinks: postLinksForLog,
            uids: unique([postAuthorUidForLog, newInteractorUid].filter(Boolean))
          }
        },
        debugData: {
          postIndex: post && post.index ? post.index : null,
          authorName: postAuthorNameForLog,
          authorUrl: String(post && post.authorUrl ? post.authorUrl : ''),
          rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : ''),
          source: vars.isFindNewInteractors ? 'new_interactors_or_post' : 'post'
        }
      });
    }
  }
}

results.phones = unique(results.phones);
results.linkGroupZalos = unique(results.linkGroupZalos);
results.uids = unique(results.uids);
results.postLinks = unique(results.postLinks);
sourcePost.phones = unique(sourcePost.phones);
sourcePost.linkGroupZalos = unique(sourcePost.linkGroupZalos);
sourcePost.uids = unique(sourcePost.uids);
sourcePost.postLinks = unique(sourcePost.postLinks);
sourceNewInteractors.uids = unique(sourceNewInteractors.uids);

vars.findDataMatchedPostIndexes = unique(matchedPostIndexes);
vars.findDataPostFilterEnabled = postFilterEnabled;

return {
  matchedPosts,
  phones: results.phones,
  linkGroupZalos: results.linkGroupZalos,
  uids: results.uids,
  postLinks: results.postLinks,
  sourceCounts: {
    post: {
      phones: sourcePost.phones.length,
      linkGroupZalos: sourcePost.linkGroupZalos.length,
      uids: sourcePost.uids.length,
      postLinks: sourcePost.postLinks.length
    },
    newInteractors: {
      uids: sourceNewInteractors.uids.length
    }
  }
};
$v641$, updated_at = now()
 WHERE id = 2863 AND md5(code) = 'c966c4608a3cbee3f524915fb4c090eb';

UPDATE public.auto_blocks SET code = $v641$// Centralized AI find-data filter via ai_using.
const __aiFindDataUsingCode = "fb_collect_group_comments_ai_filter";
const __extractAIText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (Array.isArray(value)) return value.map(__extractAIText).filter(Boolean).join('\n').trim();
  if (typeof value === 'object') {
    const data = value;
    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result;
    if (direct !== undefined && direct !== null && direct !== value) {
      const directText = __extractAIText(direct);
      if (directText) return directText;
    }
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value || '').trim();
};
const __callCentralAI = async (usingCode, payload) => {
  if (!usingCode) throw new Error('Thiếu mã cấu hình AI');
  if (typeof helpers.callAIUsing !== 'function') throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  const result = await helpers.callAIUsing(usingCode, payload || {});
  if (result && result.unsupported) throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : 'AI lỗi'));
  return result;
};
const __splitMeaningTraits = (prompt) => {
  const lines = String(prompt || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [String(prompt || '').trim()].filter(Boolean);
};
const __extractJsonText = (raw) => {
  const trimmed = String(raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : trimmed).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
};
const checkMeaningAI = async (options = {}) => {
  const prompt = String(options.prompt || '').trim();
  const contentText = String(options.contentText || '').trim();
  const entityType = String(options.entityType || 'content').trim() || 'content';
  const traits = __splitMeaningTraits(prompt);
  const criteria = traits.map((trait, index) => (index + 1) + '. ' + trait).join('\n');
  const result = await __callCentralAI(__aiFindDataUsingCode, {
    prompt,
    criteria,
    entity_type: entityType,
    entityType,
    content: JSON.stringify(contentText),
    contentText
  });
  const rawResult = __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));
  let matched = false;
  let reason = '';
  try {
    const parsed = JSON.parse(__extractJsonText(rawResult));
    matched = parsed.matched === true || parsed.match === true || String(parsed.result || parsed.checkResult || '').toLowerCase() === 'matched';
    reason = String(parsed.reason || parsed.explanation || parsed.message || '').trim();
  } catch {
    const normalized = rawResult.toLowerCase();
    matched = normalized.includes('matched') || normalized.includes('true') || normalized.includes('phù hợp') || normalized.includes('phu hop') || normalized.includes('có');
    reason = rawResult.slice(0, 500);
  }
  return {
    ok: true,
    matched,
    checkResult: matched ? 'matched' : 'not_matched',
    prompt,
    finalPrompt: String(result.renderedUserPrompt || result.rendered_user_prompt || ''),
    rawResult,
    reason,
    provider: result.provider || '',
    model: result.model || ''
  };
};

if (vars.isFindInComment !== true && vars.isFindNewInteractors !== true) {
  vars.findDataComments = [];
  return { commentItems: [] };
}

const selectors = {
  posts: await helpers.element('fb_post_in_uid'),
  commentButton: await helpers.element('fb_comment_in_post_btn'),
  mostRelevant: await helpers.element('fb_most_relevant_btn'),
  allComments: await helpers.element('fb_all_comments_btn'),
  newestComments: await helpers.element('fb_newest_comments_btn'),
  dialog: await helpers.element('fb_dialog'),
  commentElement: await helpers.element('fb_cmt_element_full'),
  uidInComment: await helpers.element('fb_uid_in_cmt_element'),
  contentInComment: await helpers.element('fb_content_in_cmt_element'),
  closeDialog: await helpers.element('fb_close_dialog_btn')
};
const postLimit = Math.max(1, Number(vars.countPostFindData || 10));
const commentLimit = Math.max(1, Number(vars.countCommentFindData || 30));
const sortType = String(vars.sortTypeComment || 'most_relevant');
const postFilterEnabled = vars.findDataPostFilterEnabled === true;
const matchedPostIndexesForComments = Array.isArray(vars.findDataMatchedPostIndexes)
  ? vars.findDataMatchedPostIndexes.map(value => Math.max(1, Number(value) || 0)).filter(Boolean)
  : [];

const commentResult = await page.evaluate(`
  const selectors = __args[0];
  const postLimit = __args[1];
  const commentLimit = __args[2];
  const sortType = __args[3];
  const postFilterEnabled = __args[4] === true;
  const matchedPostIndexes = new Set((Array.isArray(__args[5]) ? __args[5] : []).map(value => Math.max(1, Number(value) || 0)).filter(Boolean));

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function xpathAll(xpath, root) {
    const out = [];
    if (!xpath) return out;
    try {
      const result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
    } catch {}
    return out.filter(Boolean);
  }

  function first(xpath, root) {
    return xpathAll(xpath, root)[0] || null;
  }

  function clickSynthetic(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); return true; } catch {}
    return false;
  }

  async function waitFor(fn, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = fn();
      if (value) return value;
      await delay(300);
    }
    return null;
  }

  function extractUid(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.href);
      const id = url.searchParams.get('id');
      if (id) return id;
      const parts = url.pathname.split('/').filter(Boolean);
      const userIndex = parts.indexOf('user');
      if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];
      return parts[parts.length - 1] || '';
    } catch {
      return String(href || '').trim();
    }
  }

  function commentContentOf(comment, authorLink, messageXpath) {
    const candidates = xpathAll(messageXpath, comment)
      .filter(isVisible)
      .filter(el => !authorLink || el !== authorLink && !(el.contains && el.contains(authorLink)))
      .map(el => (el.innerText || el.textContent || '').trim())
      .filter(Boolean);
    return candidates[0] || (comment.innerText || comment.textContent || '').trim();
  }

  const rows = [];
  const postCommentStats = [];
  const posts = xpathAll(selectors.posts).slice(0, postLimit);
  for (let p = 0; p < posts.length; p++) {
    const post = posts[p];
    const postStat = {
      postIndex: p + 1,
      opened: false,
      sorted: sortType === 'most_relevant',
      commentsCount: 0,
      error: '',
      filteredByPostContent: false
    };
    if (postFilterEnabled && !matchedPostIndexes.has(p + 1)) {
      postStat.filteredByPostContent = true;
      postStat.error = 'Không đạt điều kiện nội dung bài viết';
      postCommentStats.push(postStat);
      continue;
    }
    try {
      post.scrollIntoView(true);
      await delay(700);
      const button = first(selectors.commentButton, post);
      if (!button) {
        postStat.error = 'Không tìm thấy nút comment';
        continue;
      }
      clickSynthetic(button);
      postStat.opened = true;
      await delay(2000);

      let root = await waitFor(() => first(selectors.dialog, document), 5000);
      if (!root) root = document.documentElement;

      if (sortType !== 'most_relevant') {
        postStat.sorted = false;
        const sortButton = first(selectors.mostRelevant, root) || first(selectors.mostRelevant, document);
        if (sortButton) {
          clickSynthetic(sortButton);
          await delay(800);
          const optionXpath = sortType === 'newest' ? selectors.newestComments : selectors.allComments;
          const option = first(optionXpath, document);
          if (option) {
            clickSynthetic(option);
            postStat.sorted = true;
            await delay(2000);
          } else {
            postStat.error = 'Không tìm thấy lựa chọn sắp xếp comment';
          }
        } else {
          postStat.error = 'Không tìm thấy nút sắp xếp comment';
        }
      }

      let comments = xpathAll(selectors.commentElement, root);
      const startedAt = Date.now();
      let stableCount = 0;
      while (comments.length < commentLimit && Date.now() - startedAt < 90 * 1000 && stableCount < 3) {
        const oldCount = comments.length;
        if (comments.length > 0) comments[comments.length - 1].scrollIntoView(true);
        await delay(1500);
        comments = xpathAll(selectors.commentElement, root);
        stableCount = comments.length <= oldCount ? stableCount + 1 : 0;
      }

      const selectedComments = comments.slice(0, commentLimit);
      postStat.commentsCount = selectedComments.length;
      selectedComments.forEach((comment, i) => {
        const link = first(selectors.uidInComment, comment);
        const href = link ? (link.href || link.getAttribute('href') || '') : '';
        const authorName = link ? (link.innerText || link.textContent || '').trim() : '';
        const content = commentContentOf(comment, link, selectors.contentInComment);
        rows.push({
          postIndex: p + 1,
          commentIndex: i + 1,
          content,
          authorName,
          authorUrl: href,
          authorUid: extractUid(href)
        });
      });
    } catch (err) {
      postStat.error = err && err.message ? err.message : String(err || 'Lỗi mở comment');
    } finally {
      const closeButton = first(selectors.closeDialog, document);
      if (closeButton) {
        clickSynthetic(closeButton);
        await delay(1000);
      }
      postCommentStats.push(postStat);
    }
  }

  return { rows, postCommentStats };
`, selectors, postLimit, commentLimit, sortType, postFilterEnabled, matchedPostIndexesForComments);

const commentItems = Array.isArray(commentResult)
  ? commentResult
  : (commentResult && Array.isArray(commentResult.rows) ? commentResult.rows : []);
const commentPostStats = commentResult && Array.isArray(commentResult.postCommentStats)
  ? commentResult.postCommentStats
  : [];
vars.findDataComments = commentItems;
helpers.log('Đã tải ' + vars.findDataComments.length + ' comment trong group');

function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') {
    vars.findDataResults = {};
  }
  const results = vars.findDataResults;
  if (!Array.isArray(results.phones)) results.phones = [];
  if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = [];
  if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.uidProfiles)) results.uidProfiles = [];
  if (!Array.isArray(results.phoneProfiles)) results.phoneProfiles = [];
  if (!Array.isArray(results.postLinks)) results.postLinks = [];
  if (!Array.isArray(results.groupMembers)) results.groupMembers = [];
  if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
  if (!results.sourceData.comment || typeof results.sourceData.comment !== 'object') results.sourceData.comment = {};
  if (!Array.isArray(results.sourceData.comment.phones)) results.sourceData.comment.phones = [];
  if (!Array.isArray(results.sourceData.comment.linkGroupZalos)) results.sourceData.comment.linkGroupZalos = [];
  if (!Array.isArray(results.sourceData.comment.uids)) results.sourceData.comment.uids = [];
  if (!results.sourceData.newInteractors || typeof results.sourceData.newInteractors !== 'object') results.sourceData.newInteractors = {};
  if (!Array.isArray(results.sourceData.newInteractors.uids)) results.sourceData.newInteractors.uids = [];
  return results;
}

function normalizeKeywordText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function keywordList() {
  return String(vars.commentKeywords || '')
    .split(',')
    .map(x => normalizeKeywordText(x.trim()))
    .filter(Boolean);
}

function matchesContent(text) {
  if (!vars.isFindCommentByKeywords) return true;
  const words = keywordList();
  if (words.length === 0) return true;
  const haystack = normalizeKeywordText(text);
  return words.some(word => haystack.includes(word));
}

function isMeaningAiEnabled() {
  return vars.isFindCommentByContentAI === true && String(vars.commentContentAI || '').trim().length > 0;
}

function createEmptyMeaningAiCheck() {
  return {
    ok: true,
    matched: true,
    checkResult: '',
    prompt: String(vars.commentContentAI || ''),
    finalPrompt: '',
    rawResult: '',
    reason: '',
    error: ''
  };
}

function normalizeMeaningAiCheck(result) {
  if (result && result.unsupported) {
    return {
      ok: false,
      matched: false,
      checkResult: 'error',
      prompt: String(vars.commentContentAI || ''),
      finalPrompt: '',
      rawResult: '',
      reason: 'Runtime chưa hỗ trợ helper callAIUsing',
      error: 'Runtime chưa hỗ trợ helper callAIUsing'
    };
  }
  const raw = result && typeof result === 'object' ? result : {};
  const checkResult = String(raw.checkResult || raw.check_result || (raw.ok === true ? (raw.matched === true ? 'matched' : 'not_matched') : 'error'));
  return {
    ok: raw.ok === true,
    matched: raw.matched === true,
    checkResult,
    prompt: String(raw.prompt || vars.commentContentAI || ''),
    finalPrompt: String(raw.finalPrompt || raw.final_prompt || ''),
    rawResult: String(raw.rawResult || raw.raw_result || ''),
    reason: String(raw.reason || raw.error || ''),
    error: String(raw.error || '')
  };
}

async function checkMeaningAi(content, entityType) {
  if (!isMeaningAiEnabled()) return createEmptyMeaningAiCheck();
  const result = await checkMeaningAI({
    contentText: String(content || ''),
    prompt: String(vars.commentContentAI || ''),
    entityType
  });
  return normalizeMeaningAiCheck(result);
}

function isMeaningAiAccepted(aiCheck) {
  return !isMeaningAiEnabled() || (aiCheck && aiCheck.ok === true && aiCheck.matched === true);
}

function isMeaningAiFailed(aiCheck) {
  return isMeaningAiEnabled() && (!aiCheck || aiCheck.ok !== true);
}

function getMeaningAiMessage(aiCheck) {
  if (isMeaningAiFailed(aiCheck)) return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân');
  if (isMeaningAiEnabled() && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI';
  return 'Đúng ý nghĩa AI';
}

function buildFilterData(matchedKeyword, aiCheck) {
  const keywordEnabled = vars.isFindCommentByKeywords === true && String(vars.commentKeywords || '').trim().length > 0;
  const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : '');
  const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : '');
  return {
    keywordEnabled,
    keyword: keywordEnabled ? String(vars.commentKeywords || '') : null,
    matchedKeyword: keywordEnabled ? matchedKeyword : null,
    aiPrompt: String(vars.commentContentAI || '') || null,
    aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''),
    aiRawResult: rawResult,
    aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''),
    aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null,
    aiReason: reason || null,
    aiResult: rawResult || null
  };
}


function normalizePhone(value) {
  const raw = String(value || '').trim();
  const compact = raw.replace(/[\s.\-]/g, '');
  let digits = compact.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  if (/^0[35789]\d{8}$/.test(digits)) return digits;
  return '';
}

function findPhones(text) {
  const matches = String(text || '').match(/(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}\b/g) || [];
  return matches.map(normalizePhone).filter(Boolean);
}

function findZaloLinks(text) {
  const matches = String(text || '').match(/(?:https?:\/\/)?zalo\.me\/g\/[a-z0-9]+/gi) || [];
  return matches.map(x => x.trim()).filter(Boolean);
}

function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

function authorUidFromItem(item) {
  const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim();
  const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim();

  try {
    const url = new URL(rawHref, 'https://www.facebook.com');
    const parts = url.pathname
      .split('/')
      .map(part => {
        try { return decodeURIComponent(part); } catch { return part; }
      })
      .map(part => part.trim())
      .filter(Boolean);
    const lowerParts = parts.map(part => part.toLowerCase());
    const firstPathPart = lowerParts[0] || '';

    if (firstPathPart === 'profile.php') {
      const id = url.searchParams.get('id');
      return id ? id.trim() : '';
    }

    const userIndex = lowerParts.indexOf('user');
    if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];

    if (firstPathPart === 'groups') return '';

    const blockedPathParts = new Set(['posts', 'permalink', 'permalink.php', 'story.php', 'photo.php', 'photos', 'watch', 'reel', 'videos', 'video.php']);
    if (lowerParts.some(part => blockedPathParts.has(part))) return '';

    if (parts.length === 1 && parts[0]) return parts[0];
  } catch {}

  return fallbackUid;
}

const results = ensureResults();
const sourceComment = results.sourceData.comment;
const sourceNewInteractors = results.sourceData.newInteractors;
const commentSourcePosts = Array.isArray(vars.findDataPosts) ? vars.findDataPosts : [];
const commentsByPost = new Map();
for (const comment of vars.findDataComments) {
  const postIndex = Math.max(1, Number(comment && comment.postIndex ? comment.postIndex : 0));
  if (!commentsByPost.has(postIndex)) commentsByPost.set(postIndex, []);
  commentsByPost.get(postIndex).push(comment);
}

const commentLogEvents = [];
let matchedComments = 0;
let globalCommentIndex = 0;

for (const rawStat of commentPostStats) {
  const stat = rawStat && typeof rawStat === 'object' ? rawStat : {};
  const postIndex = Math.max(1, Number(stat.postIndex || 0));
  const commentsCount = Math.max(0, Number(stat.commentsCount || 0));
  const opened = stat.opened === true;
  const sorted = stat.sorted === true;
  const error = String(stat.error || '').trim();
  const sourcePost = commentSourcePosts[postIndex - 1] || {};
  const postUrl = String(sourcePost && sourcePost.postLink ? sourcePost.postLink : '');
  const commentsForPost = commentsByPost.get(postIndex) || [];

  commentLogEvents.push({
    eventType: 'open_comments',
    eventName: 'Mở comment',
    targetType: 'comment',
    status: opened ? 'success' : 'skipped',
    isUserVisible: false,
    xpath: selectors.commentButton,
    itemIndex: postIndex,
    targetUrl: postUrl,
    message: opened ? 'Đã mở comment của bài post #' + postIndex : 'Bỏ qua mở comment của bài post #' + postIndex,
    debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error }
  });

  if (sortType !== 'most_relevant' && opened) {
    commentLogEvents.push({
      eventType: 'sort_comments',
      eventName: 'Sắp xếp comment',
      targetType: 'comment',
      status: sorted ? 'success' : 'failed',
      isUserVisible: false,
      itemIndex: postIndex,
      targetUrl: postUrl,
      message: sorted ? 'Đã đổi sắp xếp comment của bài post #' + postIndex : (error || 'Không sắp xếp được comment của bài post #' + postIndex),
      debugData: {
        sortType,
        postIndex,
        postUrl,
        error,
        selectors: {
          sortButton: selectors.mostRelevant,
          allComments: selectors.allComments,
          newestComments: selectors.newestComments
        }
      }
    });
  }

  commentLogEvents.push({
    eventType: 'collect_comments',
    eventName: 'Lấy danh sách comment',
    targetType: 'comment',
    status: opened ? 'success' : 'skipped',
    isUserVisible: true,
    xpath: selectors.commentElement,
    elementCount: commentsCount,
    itemIndex: postIndex,
    targetUrl: postUrl,
    message: 'Bài post #' + postIndex + ': lấy được ' + commentsCount + ' comment',
    debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error }
  });

  for (const comment of commentsForPost) {
    globalCommentIndex++;
    const content = String(comment && comment.content ? comment.content : '');
    const contentMatches = matchesContent(content);
    const meaningAiCheck = vars.isFindInComment && contentMatches ? await checkMeaningAi(content, 'comment') : createEmptyMeaningAiCheck();
    const meaningAiAccepted = isMeaningAiAccepted(meaningAiCheck);
    const commentAuthorUidForLog = authorUidFromItem(comment);
    const commentAuthorNameForLog = String(comment && comment.authorName ? comment.authorName : '').trim();
    const commentPhonesForLog = findPhones(content);
    const commentZaloLinksForLog = findZaloLinks(content);
    const commentPostLinksForLog = postUrl ? [postUrl] : [];

    if (vars.isFindInComment && contentMatches && !meaningAiAccepted) {
      commentLogEvents.push({
        eventType: 'extract_comment_data',
        eventName: 'Lấy thông tin comment',
        targetType: 'comment',
        status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped',
        isUserVisible: true,
        itemIndex: Math.max(1, Number(comment && comment.commentIndex ? comment.commentIndex : 0)),
        targetUrl: String(comment && comment.authorUrl ? comment.authorUrl : ''),
        message: getMeaningAiMessage(meaningAiCheck),
        extractedData: {
          entity: {
            type: 'comment',
            url: String(comment && comment.authorUrl ? comment.authorUrl : ''),
            name: String(comment && comment.authorName ? comment.authorName : '').trim() || null,
            uid: authorUidFromItem(comment) || null,
            contentText: content
          },
          filters: buildFilterData(true, meaningAiCheck),
          values: {
            phones: findPhones(content),
            zaloGroupLinks: findZaloLinks(content),
            postLinks: postUrl ? [postUrl] : [],
            uids: unique([authorUidFromItem(comment)].filter(Boolean))
          }
        },
        debugData: {
          postIndex,
          commentIndexInPost: Math.max(1, Number(comment && comment.commentIndex ? comment.commentIndex : 0)),
          postUrl,
          authorName: String(comment && comment.authorName ? comment.authorName : '').trim(),
          authorUrl: String(comment && comment.authorUrl ? comment.authorUrl : '')
        }
      });
    }

    if (vars.isFindInComment && contentMatches && meaningAiAccepted) {
      matchedComments++;
      if (vars.isFindPhone) {
        results.phones.push(...commentPhonesForLog);
        sourceComment.phones.push(...commentPhonesForLog);
        for (const phone of commentPhonesForLog) {
          results.phoneProfiles.push({
            phone,
            name: commentAuthorNameForLog,
            uid: commentAuthorUidForLog,
            url: String(comment && comment.authorUrl ? comment.authorUrl : ''),
            source: 'comment'
          });
        }
      }
      if (vars.isFindLinkGroupZalo) {
        results.linkGroupZalos.push(...commentZaloLinksForLog);
        sourceComment.linkGroupZalos.push(...commentZaloLinksForLog);
      }
      if (vars.isFindUid && commentAuthorUidForLog) {
        results.uids.push(commentAuthorUidForLog);
        sourceComment.uids.push(commentAuthorUidForLog);
        results.uidProfiles.push({
          uid: commentAuthorUidForLog,
          name: commentAuthorNameForLog,
          url: String(comment && comment.authorUrl ? comment.authorUrl : ''),
          source: 'comment'
        });
      }
    }

    const newInteractorUid = authorUidFromItem(comment);
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
      results.uidProfiles.push({
        uid: newInteractorUid,
        name: commentAuthorNameForLog,
        url: String(comment && comment.authorUrl ? comment.authorUrl : ''),
        source: 'new_interactor'
      });
    }

    const shouldLogCommentSuccess = (vars.isFindInComment && contentMatches && meaningAiAccepted) || (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid);
    const commentIndexInPost = Math.max(1, Number(comment && comment.commentIndex ? comment.commentIndex : 0));
    const authorUrl = String(comment && comment.authorUrl ? comment.authorUrl : '');

    if (shouldLogCommentSuccess) {
      commentLogEvents.push({
        eventType: 'extract_comment_data',
        eventName: 'Lấy thông tin comment',
        targetType: 'comment',
        status: 'success',
        isUserVisible: true,
        itemIndex: commentIndexInPost,
        targetUrl: authorUrl,
        message: 'Đã duyệt comment #' + commentIndexInPost,
        extractedData: {
          entity: {
            type: 'comment',
            url: authorUrl,
            name: commentAuthorNameForLog || null,
            uid: commentAuthorUidForLog || newInteractorUid || null,
            contentText: content
          },
          filters: buildFilterData(contentMatches, meaningAiCheck),
          values: {
            phones: commentPhonesForLog,
            zaloGroupLinks: commentZaloLinksForLog,
            postLinks: commentPostLinksForLog,
            uids: unique([commentAuthorUidForLog, newInteractorUid].filter(Boolean))
          }
        },
        debugData: {
          postIndex,
          commentIndexInPost,
          globalCommentIndex,
          postUrl,
          authorName: commentAuthorNameForLog,
          authorUrl,
          source: vars.isFindNewInteractors ? 'new_interactors_or_comment' : 'comment'
        }
      });
    } else if (vars.isFindInComment && !contentMatches) {
      commentLogEvents.push({
        eventType: 'extract_comment_data',
        eventName: 'Lấy thông tin comment',
        targetType: 'comment',
        status: 'skipped',
        isUserVisible: true,
        itemIndex: commentIndexInPost,
        targetUrl: authorUrl,
        message: 'Không chứa keyword',
        extractedData: {
          entity: {
            type: 'comment',
            url: authorUrl,
            name: commentAuthorNameForLog || null,
            uid: commentAuthorUidForLog || null,
            contentText: content
          },
          filters: buildFilterData(false, createEmptyMeaningAiCheck()),
          values: {
            phones: commentPhonesForLog,
            zaloGroupLinks: commentZaloLinksForLog,
            postLinks: commentPostLinksForLog,
            uids: unique([commentAuthorUidForLog].filter(Boolean))
          }
        },
        debugData: { postIndex, commentIndexInPost, globalCommentIndex, postUrl, authorName: commentAuthorNameForLog, authorUrl }
      });
    }
  }
}

if (commentLogEvents.length === 0) {
  commentLogEvents.push({
    eventType: 'collect_comments',
    eventName: 'Lấy danh sách comment',
    targetType: 'comment',
    status: 'skipped',
    isUserVisible: true,
    xpath: selectors.commentElement,
    elementCount: 0,
    message: 'Không thấy bài post để lấy comment',
    debugData: { postLimit, commentLimit, sortType }
  });
}

results.phones = unique(results.phones);
results.linkGroupZalos = unique(results.linkGroupZalos);
results.uids = unique(results.uids);
sourceComment.phones = unique(sourceComment.phones);
sourceComment.linkGroupZalos = unique(sourceComment.linkGroupZalos);
sourceComment.uids = unique(sourceComment.uids);
sourceNewInteractors.uids = unique(sourceNewInteractors.uids);

commentLogEvents.push({
  eventType: 'collect_comments_summary',
  eventName: 'Tổng kết comment',
  targetType: 'comment',
  status: 'success',
  isUserVisible: true,
  xpath: selectors.commentElement,
  elementCount: vars.findDataComments.length,
  message: 'Tổng cộng lấy được ' + vars.findDataComments.length + ' comment từ ' + commentPostStats.length + ' bài post',
  debugData: { postLimit, commentLimit, sortType, postCount: commentPostStats.length }
});

await helpers.logRunEvents(commentLogEvents);
return {
  commentItems: vars.findDataComments,
  commentPostStats,
  matchedComments,
  phones: results.phones,
  linkGroupZalos: results.linkGroupZalos,
  uids: results.uids,
  sourceCounts: {
    comment: {
      phones: sourceComment.phones.length,
      linkGroupZalos: sourceComment.linkGroupZalos.length,
      uids: sourceComment.uids.length
    },
    newInteractors: {
      uids: sourceNewInteractors.uids.length
    }
  }
};$v641$, updated_at = now()
 WHERE id = 2603 AND md5(code) = '24c0f8b97db8a5467280603dbdc99cc9';

UPDATE public.auto_blocks SET code = $v641$// Centralized AI find-data filter via ai_using.
const __aiFindDataUsingCode = "fb_collect_group_comments_ai_filter";
const __extractAIText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (Array.isArray(value)) return value.map(__extractAIText).filter(Boolean).join('\n').trim();
  if (typeof value === 'object') {
    const data = value;
    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result;
    if (direct !== undefined && direct !== null && direct !== value) {
      const directText = __extractAIText(direct);
      if (directText) return directText;
    }
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value || '').trim();
};
const __callCentralAI = async (usingCode, payload) => {
  if (!usingCode) throw new Error('Thiếu mã cấu hình AI');
  if (typeof helpers.callAIUsing !== 'function') throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  const result = await helpers.callAIUsing(usingCode, payload || {});
  if (result && result.unsupported) throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : 'AI lỗi'));
  return result;
};
const __splitMeaningTraits = (prompt) => {
  const lines = String(prompt || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [String(prompt || '').trim()].filter(Boolean);
};
const __extractJsonText = (raw) => {
  const trimmed = String(raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : trimmed).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
};
const checkMeaningAI = async (options = {}) => {
  const prompt = String(options.prompt || '').trim();
  const contentText = String(options.contentText || '').trim();
  const entityType = String(options.entityType || 'content').trim() || 'content';
  const traits = __splitMeaningTraits(prompt);
  const criteria = traits.map((trait, index) => (index + 1) + '. ' + trait).join('\n');
  const result = await __callCentralAI(__aiFindDataUsingCode, {
    prompt,
    criteria,
    entity_type: entityType,
    entityType,
    content: JSON.stringify(contentText),
    contentText
  });
  const rawResult = __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));
  let matched = false;
  let reason = '';
  try {
    const parsed = JSON.parse(__extractJsonText(rawResult));
    matched = parsed.matched === true || parsed.match === true || String(parsed.result || parsed.checkResult || '').toLowerCase() === 'matched';
    reason = String(parsed.reason || parsed.explanation || parsed.message || '').trim();
  } catch {
    const normalized = rawResult.toLowerCase();
    matched = normalized.includes('matched') || normalized.includes('true') || normalized.includes('phù hợp') || normalized.includes('phu hop') || normalized.includes('có');
    reason = rawResult.slice(0, 500);
  }
  return {
    ok: true,
    matched,
    checkResult: matched ? 'matched' : 'not_matched',
    prompt,
    finalPrompt: String(result.renderedUserPrompt || result.rendered_user_prompt || ''),
    rawResult,
    reason,
    provider: result.provider || '',
    model: result.model || ''
  };
};

if (vars.isFindInComment !== true && vars.isFindNewInteractors !== true) {
  vars.findDataComments = [];
  return { commentItems: [] };
}

const selectors = {
  posts: await helpers.element('fb_post_in_uid'),
  commentButton: await helpers.element('fb_comment_in_post_btn'),
  mostRelevant: await helpers.element('fb_most_relevant_btn'),
  allComments: await helpers.element('fb_all_comments_btn'),
  newestComments: await helpers.element('fb_newest_comments_btn'),
  dialog: await helpers.element('fb_dialog'),
  commentElement: await helpers.element('fb_cmt_element_full'),
  uidInComment: await helpers.element('fb_uid_in_cmt_element'),
  contentInComment: await helpers.element('fb_content_in_cmt_element'),
  closeDialog: await helpers.element('fb_close_dialog_btn')
};
const postLimit = Math.max(1, Number(vars.countPostFindData || 10));
const commentLimit = Math.max(1, Number(vars.countCommentFindData || 30));
const sortType = String(vars.sortTypeComment || 'most_relevant');
const postFilterEnabled = vars.findDataPostFilterEnabled === true;
const matchedPostIndexesForComments = Array.isArray(vars.findDataMatchedPostIndexes)
  ? vars.findDataMatchedPostIndexes.map(value => Math.max(1, Number(value) || 0)).filter(Boolean)
  : [];

const commentResult = await page.evaluate(`
  const selectors = __args[0];
  const postLimit = __args[1];
  const commentLimit = __args[2];
  const sortType = __args[3];
  const postFilterEnabled = __args[4] === true;
  const matchedPostIndexes = new Set((Array.isArray(__args[5]) ? __args[5] : []).map(value => Math.max(1, Number(value) || 0)).filter(Boolean));

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function xpathAll(xpath, root) {
    const out = [];
    if (!xpath) return out;
    try {
      const result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
    } catch {}
    return out.filter(Boolean);
  }

  function first(xpath, root) {
    return xpathAll(xpath, root)[0] || null;
  }

  function clickSynthetic(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); return true; } catch {}
    return false;
  }

  async function waitFor(fn, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = fn();
      if (value) return value;
      await delay(300);
    }
    return null;
  }

  function extractUid(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.href);
      const id = url.searchParams.get('id');
      if (id) return id;
      const parts = url.pathname.split('/').filter(Boolean);
      const userIndex = parts.indexOf('user');
      if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];
      return parts[parts.length - 1] || '';
    } catch {
      return String(href || '').trim();
    }
  }

  function commentContentOf(comment, authorLink, messageXpath) {
    const candidates = xpathAll(messageXpath, comment)
      .filter(isVisible)
      .filter(el => !authorLink || el !== authorLink && !(el.contains && el.contains(authorLink)))
      .map(el => (el.innerText || el.textContent || '').trim())
      .filter(Boolean);
    return candidates[0] || (comment.innerText || comment.textContent || '').trim();
  }

  const rows = [];
  const postCommentStats = [];
  const posts = xpathAll(selectors.posts).slice(0, postLimit);
  for (let p = 0; p < posts.length; p++) {
    const post = posts[p];
    const postStat = {
      postIndex: p + 1,
      opened: false,
      sorted: sortType === 'most_relevant',
      commentsCount: 0,
      error: '',
      filteredByPostContent: false
    };
    if (postFilterEnabled && !matchedPostIndexes.has(p + 1)) {
      postStat.filteredByPostContent = true;
      postStat.error = 'Không đạt điều kiện nội dung bài viết';
      postCommentStats.push(postStat);
      continue;
    }
    try {
      post.scrollIntoView(true);
      await delay(700);
      const button = first(selectors.commentButton, post);
      if (!button) {
        postStat.error = 'Không tìm thấy nút comment';
        continue;
      }
      clickSynthetic(button);
      postStat.opened = true;
      await delay(2000);

      let root = await waitFor(() => first(selectors.dialog, document), 5000);
      if (!root) root = document.documentElement;

      if (sortType !== 'most_relevant') {
        postStat.sorted = false;
        const sortButton = first(selectors.mostRelevant, root) || first(selectors.mostRelevant, document);
        if (sortButton) {
          clickSynthetic(sortButton);
          await delay(800);
          const optionXpath = sortType === 'newest' ? selectors.newestComments : selectors.allComments;
          const option = first(optionXpath, document);
          if (option) {
            clickSynthetic(option);
            postStat.sorted = true;
            await delay(2000);
          } else {
            postStat.error = 'Không tìm thấy lựa chọn sắp xếp comment';
          }
        } else {
          postStat.error = 'Không tìm thấy nút sắp xếp comment';
        }
      }

      let comments = xpathAll(selectors.commentElement, root);
      const startedAt = Date.now();
      let stableCount = 0;
      while (comments.length < commentLimit && Date.now() - startedAt < 90 * 1000 && stableCount < 3) {
        const oldCount = comments.length;
        if (comments.length > 0) comments[comments.length - 1].scrollIntoView(true);
        await delay(1500);
        comments = xpathAll(selectors.commentElement, root);
        stableCount = comments.length <= oldCount ? stableCount + 1 : 0;
      }

      const selectedComments = comments.slice(0, commentLimit);
      postStat.commentsCount = selectedComments.length;
      selectedComments.forEach((comment, i) => {
        const link = first(selectors.uidInComment, comment);
        const href = link ? (link.href || link.getAttribute('href') || '') : '';
        const authorName = link ? (link.innerText || link.textContent || '').trim() : '';
        const content = commentContentOf(comment, link, selectors.contentInComment);
        rows.push({
          postIndex: p + 1,
          commentIndex: i + 1,
          content,
          authorName,
          authorUrl: href,
          authorUid: extractUid(href)
        });
      });
    } catch (err) {
      postStat.error = err && err.message ? err.message : String(err || 'Lỗi mở comment');
    } finally {
      const closeButton = first(selectors.closeDialog, document);
      if (closeButton) {
        clickSynthetic(closeButton);
        await delay(1000);
      }
      postCommentStats.push(postStat);
    }
  }

  return { rows, postCommentStats };
`, selectors, postLimit, commentLimit, sortType, postFilterEnabled, matchedPostIndexesForComments);

const commentItems = Array.isArray(commentResult)
  ? commentResult
  : (commentResult && Array.isArray(commentResult.rows) ? commentResult.rows : []);
const commentPostStats = commentResult && Array.isArray(commentResult.postCommentStats)
  ? commentResult.postCommentStats
  : [];
vars.findDataComments = commentItems;
helpers.log('Đã tải ' + vars.findDataComments.length + ' comment trong group');

function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') {
    vars.findDataResults = {};
  }
  const results = vars.findDataResults;
  if (!Array.isArray(results.phones)) results.phones = [];
  if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = [];
  if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.uidProfiles)) results.uidProfiles = [];
  if (!Array.isArray(results.phoneProfiles)) results.phoneProfiles = [];
  if (!Array.isArray(results.postLinks)) results.postLinks = [];
  if (!Array.isArray(results.groupMembers)) results.groupMembers = [];
  if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
  if (!results.sourceData.comment || typeof results.sourceData.comment !== 'object') results.sourceData.comment = {};
  if (!Array.isArray(results.sourceData.comment.phones)) results.sourceData.comment.phones = [];
  if (!Array.isArray(results.sourceData.comment.linkGroupZalos)) results.sourceData.comment.linkGroupZalos = [];
  if (!Array.isArray(results.sourceData.comment.uids)) results.sourceData.comment.uids = [];
  if (!results.sourceData.newInteractors || typeof results.sourceData.newInteractors !== 'object') results.sourceData.newInteractors = {};
  if (!Array.isArray(results.sourceData.newInteractors.uids)) results.sourceData.newInteractors.uids = [];
  return results;
}

function normalizeKeywordText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function keywordList() {
  return String(vars.commentKeywords || '')
    .split(',')
    .map(x => normalizeKeywordText(x.trim()))
    .filter(Boolean);
}

function matchesContent(text) {
  if (!vars.isFindCommentByKeywords) return true;
  const words = keywordList();
  if (words.length === 0) return true;
  const haystack = normalizeKeywordText(text);
  return words.some(word => haystack.includes(word));
}

function isMeaningAiEnabled() {
  return vars.isFindCommentByContentAI === true && String(vars.commentContentAI || '').trim().length > 0;
}

function createEmptyMeaningAiCheck() {
  return {
    ok: true,
    matched: true,
    checkResult: '',
    prompt: String(vars.commentContentAI || ''),
    finalPrompt: '',
    rawResult: '',
    reason: '',
    error: ''
  };
}

function normalizeMeaningAiCheck(result) {
  if (result && result.unsupported) {
    return {
      ok: false,
      matched: false,
      checkResult: 'error',
      prompt: String(vars.commentContentAI || ''),
      finalPrompt: '',
      rawResult: '',
      reason: 'Runtime chưa hỗ trợ helper callAIUsing',
      error: 'Runtime chưa hỗ trợ helper callAIUsing'
    };
  }
  const raw = result && typeof result === 'object' ? result : {};
  const checkResult = String(raw.checkResult || raw.check_result || (raw.ok === true ? (raw.matched === true ? 'matched' : 'not_matched') : 'error'));
  return {
    ok: raw.ok === true,
    matched: raw.matched === true,
    checkResult,
    prompt: String(raw.prompt || vars.commentContentAI || ''),
    finalPrompt: String(raw.finalPrompt || raw.final_prompt || ''),
    rawResult: String(raw.rawResult || raw.raw_result || ''),
    reason: String(raw.reason || raw.error || ''),
    error: String(raw.error || '')
  };
}

async function checkMeaningAi(content, entityType) {
  if (!isMeaningAiEnabled()) return createEmptyMeaningAiCheck();
  const result = await checkMeaningAI({
    contentText: String(content || ''),
    prompt: String(vars.commentContentAI || ''),
    entityType
  });
  return normalizeMeaningAiCheck(result);
}

function isMeaningAiAccepted(aiCheck) {
  return !isMeaningAiEnabled() || (aiCheck && aiCheck.ok === true && aiCheck.matched === true);
}

function isMeaningAiFailed(aiCheck) {
  return isMeaningAiEnabled() && (!aiCheck || aiCheck.ok !== true);
}

function getMeaningAiMessage(aiCheck) {
  if (isMeaningAiFailed(aiCheck)) return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân');
  if (isMeaningAiEnabled() && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI';
  return 'Đúng ý nghĩa AI';
}

function buildFilterData(matchedKeyword, aiCheck) {
  const keywordEnabled = vars.isFindCommentByKeywords === true && String(vars.commentKeywords || '').trim().length > 0;
  const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : '');
  const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : '');
  return {
    keywordEnabled,
    keyword: keywordEnabled ? String(vars.commentKeywords || '') : null,
    matchedKeyword: keywordEnabled ? matchedKeyword : null,
    aiPrompt: String(vars.commentContentAI || '') || null,
    aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''),
    aiRawResult: rawResult,
    aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''),
    aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null,
    aiReason: reason || null,
    aiResult: rawResult || null
  };
}


function normalizePhone(value) {
  const raw = String(value || '').trim();
  const compact = raw.replace(/[\s.\-]/g, '');
  let digits = compact.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  if (/^0[35789]\d{8}$/.test(digits)) return digits;
  return '';
}

function findPhones(text) {
  const matches = String(text || '').match(/(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}\b/g) || [];
  return matches.map(normalizePhone).filter(Boolean);
}

function findZaloLinks(text) {
  const matches = String(text || '').match(/(?:https?:\/\/)?zalo\.me\/g\/[a-z0-9]+/gi) || [];
  return matches.map(x => x.trim()).filter(Boolean);
}

function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

function authorUidFromItem(item) {
  const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim();
  const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim();

  try {
    const url = new URL(rawHref, 'https://www.facebook.com');
    const parts = url.pathname
      .split('/')
      .map(part => {
        try { return decodeURIComponent(part); } catch { return part; }
      })
      .map(part => part.trim())
      .filter(Boolean);
    const lowerParts = parts.map(part => part.toLowerCase());
    const firstPathPart = lowerParts[0] || '';

    if (firstPathPart === 'profile.php') {
      const id = url.searchParams.get('id');
      return id ? id.trim() : '';
    }

    const userIndex = lowerParts.indexOf('user');
    if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];

    if (firstPathPart === 'groups') return '';

    const blockedPathParts = new Set(['posts', 'permalink', 'permalink.php', 'story.php', 'photo.php', 'photos', 'watch', 'reel', 'videos', 'video.php']);
    if (lowerParts.some(part => blockedPathParts.has(part))) return '';

    if (parts.length === 1 && parts[0]) return parts[0];
  } catch {}

  return fallbackUid;
}

const results = ensureResults();
const sourceComment = results.sourceData.comment;
const sourceNewInteractors = results.sourceData.newInteractors;
const commentSourcePosts = Array.isArray(vars.findDataPosts) ? vars.findDataPosts : [];
const commentsByPost = new Map();
for (const comment of vars.findDataComments) {
  const postIndex = Math.max(1, Number(comment && comment.postIndex ? comment.postIndex : 0));
  if (!commentsByPost.has(postIndex)) commentsByPost.set(postIndex, []);
  commentsByPost.get(postIndex).push(comment);
}

const commentLogEvents = [];
let matchedComments = 0;
let globalCommentIndex = 0;

for (const rawStat of commentPostStats) {
  const stat = rawStat && typeof rawStat === 'object' ? rawStat : {};
  const postIndex = Math.max(1, Number(stat.postIndex || 0));
  const commentsCount = Math.max(0, Number(stat.commentsCount || 0));
  const opened = stat.opened === true;
  const sorted = stat.sorted === true;
  const error = String(stat.error || '').trim();
  const sourcePost = commentSourcePosts[postIndex - 1] || {};
  const postUrl = String(sourcePost && sourcePost.postLink ? sourcePost.postLink : '');
  const commentsForPost = commentsByPost.get(postIndex) || [];

  commentLogEvents.push({
    eventType: 'open_comments',
    eventName: 'Mở comment',
    targetType: 'comment',
    status: opened ? 'success' : 'skipped',
    isUserVisible: false,
    xpath: selectors.commentButton,
    itemIndex: postIndex,
    targetUrl: postUrl,
    message: opened ? 'Đã mở comment của bài post #' + postIndex : 'Bỏ qua mở comment của bài post #' + postIndex,
    debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error }
  });

  if (sortType !== 'most_relevant' && opened) {
    commentLogEvents.push({
      eventType: 'sort_comments',
      eventName: 'Sắp xếp comment',
      targetType: 'comment',
      status: sorted ? 'success' : 'failed',
      isUserVisible: false,
      itemIndex: postIndex,
      targetUrl: postUrl,
      message: sorted ? 'Đã đổi sắp xếp comment của bài post #' + postIndex : (error || 'Không sắp xếp được comment của bài post #' + postIndex),
      debugData: {
        sortType,
        postIndex,
        postUrl,
        error,
        selectors: {
          sortButton: selectors.mostRelevant,
          allComments: selectors.allComments,
          newestComments: selectors.newestComments
        }
      }
    });
  }

  commentLogEvents.push({
    eventType: 'collect_comments',
    eventName: 'Lấy danh sách comment',
    targetType: 'comment',
    status: opened ? 'success' : 'skipped',
    isUserVisible: true,
    xpath: selectors.commentElement,
    elementCount: commentsCount,
    itemIndex: postIndex,
    targetUrl: postUrl,
    message: 'Bài post #' + postIndex + ': lấy được ' + commentsCount + ' comment',
    debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error }
  });

  for (const comment of commentsForPost) {
    globalCommentIndex++;
    const content = String(comment && comment.content ? comment.content : '');
    const contentMatches = matchesContent(content);
    const meaningAiCheck = vars.isFindInComment && contentMatches ? await checkMeaningAi(content, 'comment') : createEmptyMeaningAiCheck();
    const meaningAiAccepted = isMeaningAiAccepted(meaningAiCheck);
    const commentAuthorUidForLog = authorUidFromItem(comment);
    const commentAuthorNameForLog = String(comment && comment.authorName ? comment.authorName : '').trim();
    const commentPhonesForLog = findPhones(content);
    const commentZaloLinksForLog = findZaloLinks(content);
    const commentPostLinksForLog = postUrl ? [postUrl] : [];

    if (vars.isFindInComment && contentMatches && !meaningAiAccepted) {
      commentLogEvents.push({
        eventType: 'extract_comment_data',
        eventName: 'Lấy thông tin comment',
        targetType: 'comment',
        status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped',
        isUserVisible: true,
        itemIndex: Math.max(1, Number(comment && comment.commentIndex ? comment.commentIndex : 0)),
        targetUrl: String(comment && comment.authorUrl ? comment.authorUrl : ''),
        message: getMeaningAiMessage(meaningAiCheck),
        extractedData: {
          entity: {
            type: 'comment',
            url: String(comment && comment.authorUrl ? comment.authorUrl : ''),
            name: String(comment && comment.authorName ? comment.authorName : '').trim() || null,
            uid: authorUidFromItem(comment) || null,
            contentText: content
          },
          filters: buildFilterData(true, meaningAiCheck),
          values: {
            phones: findPhones(content),
            zaloGroupLinks: findZaloLinks(content),
            postLinks: postUrl ? [postUrl] : [],
            uids: unique([authorUidFromItem(comment)].filter(Boolean))
          }
        },
        debugData: {
          postIndex,
          commentIndexInPost: Math.max(1, Number(comment && comment.commentIndex ? comment.commentIndex : 0)),
          postUrl,
          authorName: String(comment && comment.authorName ? comment.authorName : '').trim(),
          authorUrl: String(comment && comment.authorUrl ? comment.authorUrl : '')
        }
      });
    }

    if (vars.isFindInComment && contentMatches && meaningAiAccepted) {
      matchedComments++;
      if (vars.isFindPhone) {
        results.phones.push(...commentPhonesForLog);
        sourceComment.phones.push(...commentPhonesForLog);
        for (const phone of commentPhonesForLog) {
          results.phoneProfiles.push({
            phone,
            name: commentAuthorNameForLog,
            uid: commentAuthorUidForLog,
            url: String(comment && comment.authorUrl ? comment.authorUrl : ''),
            source: 'comment'
          });
        }
      }
      if (vars.isFindLinkGroupZalo) {
        results.linkGroupZalos.push(...commentZaloLinksForLog);
        sourceComment.linkGroupZalos.push(...commentZaloLinksForLog);
      }
      if (vars.isFindUid && commentAuthorUidForLog) {
        results.uids.push(commentAuthorUidForLog);
        sourceComment.uids.push(commentAuthorUidForLog);
        results.uidProfiles.push({
          uid: commentAuthorUidForLog,
          name: commentAuthorNameForLog,
          url: String(comment && comment.authorUrl ? comment.authorUrl : ''),
          source: 'comment'
        });
      }
    }

    const newInteractorUid = authorUidFromItem(comment);
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
      results.uidProfiles.push({
        uid: newInteractorUid,
        name: commentAuthorNameForLog,
        url: String(comment && comment.authorUrl ? comment.authorUrl : ''),
        source: 'new_interactor'
      });
    }

    const shouldLogCommentSuccess = (vars.isFindInComment && contentMatches && meaningAiAccepted) || (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid);
    const commentIndexInPost = Math.max(1, Number(comment && comment.commentIndex ? comment.commentIndex : 0));
    const authorUrl = String(comment && comment.authorUrl ? comment.authorUrl : '');

    if (shouldLogCommentSuccess) {
      commentLogEvents.push({
        eventType: 'extract_comment_data',
        eventName: 'Lấy thông tin comment',
        targetType: 'comment',
        status: 'success',
        isUserVisible: true,
        itemIndex: commentIndexInPost,
        targetUrl: authorUrl,
        message: 'Đã duyệt comment #' + commentIndexInPost,
        extractedData: {
          entity: {
            type: 'comment',
            url: authorUrl,
            name: commentAuthorNameForLog || null,
            uid: commentAuthorUidForLog || newInteractorUid || null,
            contentText: content
          },
          filters: buildFilterData(contentMatches, meaningAiCheck),
          values: {
            phones: commentPhonesForLog,
            zaloGroupLinks: commentZaloLinksForLog,
            postLinks: commentPostLinksForLog,
            uids: unique([commentAuthorUidForLog, newInteractorUid].filter(Boolean))
          }
        },
        debugData: {
          postIndex,
          commentIndexInPost,
          globalCommentIndex,
          postUrl,
          authorName: commentAuthorNameForLog,
          authorUrl,
          source: vars.isFindNewInteractors ? 'new_interactors_or_comment' : 'comment'
        }
      });
    } else if (vars.isFindInComment && !contentMatches) {
      commentLogEvents.push({
        eventType: 'extract_comment_data',
        eventName: 'Lấy thông tin comment',
        targetType: 'comment',
        status: 'skipped',
        isUserVisible: true,
        itemIndex: commentIndexInPost,
        targetUrl: authorUrl,
        message: 'Không chứa keyword',
        extractedData: {
          entity: {
            type: 'comment',
            url: authorUrl,
            name: commentAuthorNameForLog || null,
            uid: commentAuthorUidForLog || null,
            contentText: content
          },
          filters: buildFilterData(false, createEmptyMeaningAiCheck()),
          values: {
            phones: commentPhonesForLog,
            zaloGroupLinks: commentZaloLinksForLog,
            postLinks: commentPostLinksForLog,
            uids: unique([commentAuthorUidForLog].filter(Boolean))
          }
        },
        debugData: { postIndex, commentIndexInPost, globalCommentIndex, postUrl, authorName: commentAuthorNameForLog, authorUrl }
      });
    }
  }
}

if (commentLogEvents.length === 0) {
  commentLogEvents.push({
    eventType: 'collect_comments',
    eventName: 'Lấy danh sách comment',
    targetType: 'comment',
    status: 'skipped',
    isUserVisible: true,
    xpath: selectors.commentElement,
    elementCount: 0,
    message: 'Không thấy bài post để lấy comment',
    debugData: { postLimit, commentLimit, sortType }
  });
}

results.phones = unique(results.phones);
results.linkGroupZalos = unique(results.linkGroupZalos);
results.uids = unique(results.uids);
sourceComment.phones = unique(sourceComment.phones);
sourceComment.linkGroupZalos = unique(sourceComment.linkGroupZalos);
sourceComment.uids = unique(sourceComment.uids);
sourceNewInteractors.uids = unique(sourceNewInteractors.uids);

commentLogEvents.push({
  eventType: 'collect_comments_summary',
  eventName: 'Tổng kết comment',
  targetType: 'comment',
  status: 'success',
  isUserVisible: true,
  xpath: selectors.commentElement,
  elementCount: vars.findDataComments.length,
  message: 'Tổng cộng lấy được ' + vars.findDataComments.length + ' comment từ ' + commentPostStats.length + ' bài post',
  debugData: { postLimit, commentLimit, sortType, postCount: commentPostStats.length }
});

await helpers.logRunEvents(commentLogEvents);
return {
  commentItems: vars.findDataComments,
  commentPostStats,
  matchedComments,
  phones: results.phones,
  linkGroupZalos: results.linkGroupZalos,
  uids: results.uids,
  sourceCounts: {
    comment: {
      phones: sourceComment.phones.length,
      linkGroupZalos: sourceComment.linkGroupZalos.length,
      uids: sourceComment.uids.length
    },
    newInteractors: {
      uids: sourceNewInteractors.uids.length
    }
  }
};$v641$, updated_at = now()
 WHERE id = 2864 AND md5(code) = '905a88740cee819e0e34feb1351a0476';

UPDATE public.auto_blocks SET code = $v641$// Centralized AI find-data filter via ai_using.
const __aiFindDataUsingCode = "fb_extract_data_from_search_posts_ai_filter";
const __extractAIText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (Array.isArray(value)) return value.map(__extractAIText).filter(Boolean).join('\n').trim();
  if (typeof value === 'object') {
    const data = value;
    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result;
    if (direct !== undefined && direct !== null && direct !== value) {
      const directText = __extractAIText(direct);
      if (directText) return directText;
    }
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value || '').trim();
};
const __callCentralAI = async (usingCode, payload) => {
  if (!usingCode) throw new Error('Thiếu mã cấu hình AI');
  if (typeof helpers.callAIUsing !== 'function') throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  const result = await helpers.callAIUsing(usingCode, payload || {});
  if (result && result.unsupported) throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : 'AI lỗi'));
  return result;
};
const __splitMeaningTraits = (prompt) => {
  const lines = String(prompt || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [String(prompt || '').trim()].filter(Boolean);
};
const __extractJsonText = (raw) => {
  const trimmed = String(raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : trimmed).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
};
const checkMeaningAI = async (options = {}) => {
  const prompt = String(options.prompt || '').trim();
  const contentText = String(options.contentText || '').trim();
  const entityType = String(options.entityType || 'content').trim() || 'content';
  const traits = __splitMeaningTraits(prompt);
  const criteria = traits.map((trait, index) => (index + 1) + '. ' + trait).join('\n');
  const result = await __callCentralAI(__aiFindDataUsingCode, {
    prompt,
    criteria,
    entity_type: entityType,
    entityType,
    content: JSON.stringify(contentText),
    contentText
  });
  const rawResult = __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));
  let matched = false;
  let reason = '';
  try {
    const parsed = JSON.parse(__extractJsonText(rawResult));
    matched = parsed.matched === true || parsed.match === true || String(parsed.result || parsed.checkResult || '').toLowerCase() === 'matched';
    reason = String(parsed.reason || parsed.explanation || parsed.message || '').trim();
  } catch {
    const normalized = rawResult.toLowerCase();
    matched = normalized.includes('matched') || normalized.includes('true') || normalized.includes('phù hợp') || normalized.includes('phu hop') || normalized.includes('có');
    reason = rawResult.slice(0, 500);
  }
  return {
    ok: true,
    matched,
    checkResult: matched ? 'matched' : 'not_matched',
    prompt,
    finalPrompt: String(result.renderedUserPrompt || result.rendered_user_prompt || ''),
    rawResult,
    reason,
    provider: result.provider || '',
    model: result.model || ''
  };
};

  function ensureResults() {
    if (!vars.findDataResults || typeof vars.findDataResults !== 'object') vars.findDataResults = {};
    const results = vars.findDataResults;
    if (!Array.isArray(results.phones)) results.phones = [];
    if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = [];
    if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.uidProfiles)) results.uidProfiles = [];
  if (!Array.isArray(results.phoneProfiles)) results.phoneProfiles = [];
    if (!Array.isArray(results.postLinks)) results.postLinks = [];
    if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
    if (!results.sourceData.post || typeof results.sourceData.post !== 'object') results.sourceData.post = {};
    if (!Array.isArray(results.sourceData.post.phones)) results.sourceData.post.phones = [];
    if (!Array.isArray(results.sourceData.post.linkGroupZalos)) results.sourceData.post.linkGroupZalos = [];
    if (!Array.isArray(results.sourceData.post.uids)) results.sourceData.post.uids = [];
    if (!Array.isArray(results.sourceData.post.postLinks)) results.sourceData.post.postLinks = [];
    return results;
  }
  function normalizeKeywordText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  }
  function keywordList() {
    return String(vars.postKeywords || '').split(',').map(x => normalizeKeywordText(x.trim())).filter(Boolean);
  }
  function matchesContent(text) {
    if (!vars.isFindPostByKeywords) return true;
    const words = keywordList();
    if (words.length === 0) return true;
    const haystack = normalizeKeywordText(text);
    return words.some(word => haystack.includes(word));
  }
  function isMeaningAiEnabled() { return vars.isFindPostByContentAI === true && String(vars.postContentAI || '').trim().length > 0; }
  function createEmptyMeaningAiCheck() {
    return { ok: true, matched: true, checkResult: '', prompt: String(vars.postContentAI || ''), finalPrompt: '', rawResult: '', reason: '', error: '' };
  }
  function normalizeMeaningAiCheck(result) {
    if (result && result.unsupported) {
      return { ok: false, matched: false, checkResult: 'error', prompt: String(vars.postContentAI || ''), finalPrompt: '', rawResult: '', reason: 'Runtime chưa hỗ trợ helper callAIUsing', error: 'Runtime chưa hỗ trợ helper callAIUsing' };
    }
    const raw = result && typeof result === 'object' ? result : {};
    const checkResult = String(raw.checkResult || raw.check_result || (raw.ok === true ? (raw.matched === true ? 'matched' : 'not_matched') : 'error'));
    return { ok: raw.ok === true, matched: raw.matched === true, checkResult, prompt: String(raw.prompt || vars.postContentAI || ''), finalPrompt: String(raw.finalPrompt || raw.final_prompt || ''), rawResult: String(raw.rawResult || raw.raw_result || ''), reason: String(raw.reason || raw.error || ''), error: String(raw.error || '') };
  }
  async function checkMeaningAi(content, entityType) {
    if (!isMeaningAiEnabled()) return createEmptyMeaningAiCheck();
    const result = await checkMeaningAI({ contentText: String(content || ''), prompt: String(vars.postContentAI || ''), entityType });
    return normalizeMeaningAiCheck(result);
  }
  function isMeaningAiAccepted(aiCheck) { return !isMeaningAiEnabled() || (aiCheck && aiCheck.ok === true && aiCheck.matched === true); }
  function isMeaningAiFailed(aiCheck) { return isMeaningAiEnabled() && (!aiCheck || aiCheck.ok !== true); }
  function getMeaningAiMessage(aiCheck) {
    if (isMeaningAiFailed(aiCheck)) return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân');
    if (isMeaningAiEnabled() && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI';
    return 'Đúng ý nghĩa AI';
  }
  function buildFilterData(matchedKeyword, aiCheck) {
    const keywordEnabled = vars.isFindPostByKeywords === true && String(vars.postKeywords || '').trim().length > 0;
    const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : '');
    const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : '');
    return { keywordEnabled, keyword: keywordEnabled ? String(vars.postKeywords || '') : null, matchedKeyword: keywordEnabled ? matchedKeyword : null, aiPrompt: String(vars.postContentAI || '') || null, aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''), aiRawResult: rawResult, aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''), aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null, aiReason: reason || null, aiResult: rawResult || null };
  }
  function normalizePhone(value) {
    const raw = String(value || '').trim();
    const compact = raw.replace(/[\s.\-]/g, '');
    let digits = compact.replace(/[^\d+]/g, '');
    if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
    else if (digits.startsWith('84')) digits = '0' + digits.slice(2);
    digits = digits.replace(/\D/g, '');
    if (/^0[35789]\d{8}$/.test(digits)) return digits;
    return '';
  }
  function findPhones(text) {
    const matches = String(text || '').match(/(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}\b/g) || [];
    return matches.map(normalizePhone).filter(Boolean);
  }
  function findZaloLinks(text) {
    const matches = String(text || '').match(/(?:https?:\/\/)?zalo\.me\/g\/[a-z0-9]+/gi) || [];
    return matches.map(x => x.trim()).filter(Boolean);
  }
  function unique(arr) { return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean))); }
  function authorUidFromItem(item) {
    const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim();
    const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim();
    try {
      const url = new URL(rawHref, 'https://www.facebook.com');
      const parts = url.pathname.split('/').map(part => { try { return decodeURIComponent(part); } catch { return part; } }).map(part => part.trim()).filter(Boolean);
      const lowerParts = parts.map(part => part.toLowerCase());
      const firstPathPart = lowerParts[0] || '';
      if (firstPathPart === 'profile.php') {
        const id = url.searchParams.get('id');
        return id ? id.trim() : '';
      }
      const userIndex = lowerParts.indexOf('user');
      if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];
      if (firstPathPart === 'groups') return '';
      const blockedPathParts = new Set(['posts', 'permalink', 'permalink.php', 'story.php', 'photo.php', 'photos', 'watch', 'reel', 'videos', 'video.php']);
      if (lowerParts.some(part => blockedPathParts.has(part))) return '';
      if (parts.length === 1 && parts[0]) return parts[0];
    } catch {}
    return fallbackUid;
  }

  const results = ensureResults();
  const sourcePost = results.sourceData.post;
  const posts = Array.isArray(input.posts) ? input.posts : (Array.isArray(vars.findDataSearchPosts) ? vars.findDataSearchPosts : []);
  
let matchedPosts = 0;
const postFilterEnabled = (
  vars.isFindPostByKeywords === true && String(vars.postKeywords || '').trim().length > 0
) || (
  vars.isFindPostByContentAI === true && String(vars.postContentAI || '').trim().length > 0
);
const matchedPostIndexes = [];
vars.findDataPostFilterEnabled = postFilterEnabled;
vars.findDataMatchedPostIndexes = [];


  if (vars.findDataSearchHasPost) {
    for (let postLoopIndex = 0; postLoopIndex < posts.length; postLoopIndex++) {
    const post = posts[postLoopIndex];
      const content = String(post && post.content ? post.content : '');
      const postIndexForFilter = Math.max(1, Number(post && post.index ? post.index : postLoopIndex + 1));
      const contentMatches = matchesContent(content);
      const shouldExtractPostData = vars.isFindInPost || vars.isFindPostLink;
    const shouldFilterPostForComments = vars.isFindInComment === true && postFilterEnabled;
    const shouldEvaluatePostContent = shouldExtractPostData || shouldFilterPostForComments;
    const meaningAiCheck = shouldEvaluatePostContent && contentMatches ? await checkMeaningAi(content, 'post') : createEmptyMeaningAiCheck();
      const meaningAiAccepted = isMeaningAiAccepted(meaningAiCheck);
      const postAuthorUidForLog = authorUidFromItem(post);
      const postAuthorNameForLog = String(post && post.authorName ? post.authorName : '').trim();
      const postPhonesForLog = findPhones(content);
      const postZaloLinksForLog = findZaloLinks(content);
      const postLinksForLog = post && post.postLink ? [String(post.postLink)] : [];
      const postIndex = post && post.index ? post.index : null;
      const postUrl = String(post && post.postLink ? post.postLink : '');

      if (shouldEvaluatePostContent && !contentMatches) {
        await helpers.logRunEvent({ eventType: 'extract_post_data', eventName: 'Lấy thông tin bài post', targetType: 'post', status: 'skipped', isUserVisible: true, itemIndex: postIndex, targetUrl: postUrl, message: 'Không chứa keyword', extractedData: { entity: { type: 'post', url: postUrl, name: postAuthorNameForLog || null, uid: postAuthorUidForLog || null, contentText: content }, filters: buildFilterData(false, createEmptyMeaningAiCheck()), values: { phones: postPhonesForLog, zaloGroupLinks: postZaloLinksForLog, postLinks: postLinksForLog, uids: unique([postAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, authorName: postAuthorNameForLog, authorUrl: String(post && post.authorUrl ? post.authorUrl : ''), rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : ''), searchKeyword: vars.findDataSearchKeyword || '' } });
        continue;
      }

      if (shouldEvaluatePostContent && contentMatches && !meaningAiAccepted) {
        await helpers.logRunEvent({ eventType: 'extract_post_data', eventName: 'Lấy thông tin bài post', targetType: 'post', status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped', isUserVisible: true, itemIndex: postIndex, targetUrl: postUrl, message: getMeaningAiMessage(meaningAiCheck), extractedData: { entity: { type: 'post', url: postUrl, name: postAuthorNameForLog || null, uid: postAuthorUidForLog || null, contentText: content }, filters: buildFilterData(true, meaningAiCheck), values: { phones: postPhonesForLog, zaloGroupLinks: postZaloLinksForLog, postLinks: postLinksForLog, uids: unique([postAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, authorName: postAuthorNameForLog, authorUrl: String(post && post.authorUrl ? post.authorUrl : ''), rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : ''), searchKeyword: vars.findDataSearchKeyword || '' } });
        continue;
      }

      if (shouldEvaluatePostContent && contentMatches && meaningAiAccepted) {
        matchedPosts++;
      if (postFilterEnabled) matchedPostIndexes.push(postIndexForFilter);
        if (vars.isFindInPost && vars.isFindPhone) { results.phones.push(...postPhonesForLog); sourcePost.phones.push(...postPhonesForLog); for (const phone of postPhonesForLog) results.phoneProfiles.push({ phone, name: postAuthorNameForLog, uid: postAuthorUidForLog, url: String(post && post.authorUrl ? post.authorUrl : ''), source: 'post' }); }
        if (vars.isFindInPost && vars.isFindLinkGroupZalo) { results.linkGroupZalos.push(...postZaloLinksForLog); sourcePost.linkGroupZalos.push(...postZaloLinksForLog); }
        if (vars.isFindInPost && vars.isFindUid && postAuthorUidForLog) { results.uids.push(postAuthorUidForLog); sourcePost.uids.push(postAuthorUidForLog); results.uidProfiles.push({ uid: postAuthorUidForLog, name: postAuthorNameForLog, url: String(post && post.authorUrl ? post.authorUrl : ''), source: 'post' }); }
        if (vars.isFindPostLink) { results.postLinks.push(...postLinksForLog); sourcePost.postLinks.push(...postLinksForLog); }
        await helpers.logRunEvent({ eventType: 'extract_post_data', eventName: 'Lấy thông tin bài post', targetType: 'post', status: 'success', isUserVisible: true, itemIndex: postIndex, targetUrl: postUrl, message: 'Đã duyệt bài post #' + (postIndex || ''), extractedData: { entity: { type: 'post', url: postUrl, name: postAuthorNameForLog || null, uid: postAuthorUidForLog || null, contentText: content }, filters: buildFilterData(contentMatches, meaningAiCheck), values: { phones: postPhonesForLog, zaloGroupLinks: postZaloLinksForLog, postLinks: postLinksForLog, uids: unique([postAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, authorName: postAuthorNameForLog, authorUrl: String(post && post.authorUrl ? post.authorUrl : ''), rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : ''), searchKeyword: vars.findDataSearchKeyword || '' } });
      }
    }
  }

  results.phones = unique(results.phones); results.linkGroupZalos = unique(results.linkGroupZalos); results.uids = unique(results.uids); results.postLinks = unique(results.postLinks);
  sourcePost.phones = unique(sourcePost.phones); sourcePost.linkGroupZalos = unique(sourcePost.linkGroupZalos); sourcePost.uids = unique(sourcePost.uids); sourcePost.postLinks = unique(sourcePost.postLinks);
  vars.findDataMatchedPostIndexes = unique(matchedPostIndexes);
  vars.findDataPostFilterEnabled = postFilterEnabled;
  return { matchedPosts, phones: results.phones, linkGroupZalos: results.linkGroupZalos, uids: results.uids, postLinks: results.postLinks };
$v641$, updated_at = now()
 WHERE id = 2718 AND md5(code) = '892b788ee949373baa4ba1674d4d11c4';

UPDATE public.auto_blocks SET code = $v641$// Centralized AI find-data filter via ai_using.
const __aiFindDataUsingCode = "fb_extract_data_from_search_posts_ai_filter";
const __extractAIText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (Array.isArray(value)) return value.map(__extractAIText).filter(Boolean).join('\n').trim();
  if (typeof value === 'object') {
    const data = value;
    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result;
    if (direct !== undefined && direct !== null && direct !== value) {
      const directText = __extractAIText(direct);
      if (directText) return directText;
    }
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value || '').trim();
};
const __callCentralAI = async (usingCode, payload) => {
  if (!usingCode) throw new Error('Thiếu mã cấu hình AI');
  if (typeof helpers.callAIUsing !== 'function') throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  const result = await helpers.callAIUsing(usingCode, payload || {});
  if (result && result.unsupported) throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : 'AI lỗi'));
  return result;
};
const __splitMeaningTraits = (prompt) => {
  const lines = String(prompt || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [String(prompt || '').trim()].filter(Boolean);
};
const __extractJsonText = (raw) => {
  const trimmed = String(raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : trimmed).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
};
const checkMeaningAI = async (options = {}) => {
  const prompt = String(options.prompt || '').trim();
  const contentText = String(options.contentText || '').trim();
  const entityType = String(options.entityType || 'content').trim() || 'content';
  const traits = __splitMeaningTraits(prompt);
  const criteria = traits.map((trait, index) => (index + 1) + '. ' + trait).join('\n');
  const result = await __callCentralAI(__aiFindDataUsingCode, {
    prompt,
    criteria,
    entity_type: entityType,
    entityType,
    content: JSON.stringify(contentText),
    contentText
  });
  const rawResult = __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));
  let matched = false;
  let reason = '';
  try {
    const parsed = JSON.parse(__extractJsonText(rawResult));
    matched = parsed.matched === true || parsed.match === true || String(parsed.result || parsed.checkResult || '').toLowerCase() === 'matched';
    reason = String(parsed.reason || parsed.explanation || parsed.message || '').trim();
  } catch {
    const normalized = rawResult.toLowerCase();
    matched = normalized.includes('matched') || normalized.includes('true') || normalized.includes('phù hợp') || normalized.includes('phu hop') || normalized.includes('có');
    reason = rawResult.slice(0, 500);
  }
  return {
    ok: true,
    matched,
    checkResult: matched ? 'matched' : 'not_matched',
    prompt,
    finalPrompt: String(result.renderedUserPrompt || result.rendered_user_prompt || ''),
    rawResult,
    reason,
    provider: result.provider || '',
    model: result.model || ''
  };
};

  function ensureResults() {
    if (!vars.findDataResults || typeof vars.findDataResults !== 'object') vars.findDataResults = {};
    const results = vars.findDataResults;
    if (!Array.isArray(results.phones)) results.phones = [];
    if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = [];
    if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.uidProfiles)) results.uidProfiles = [];
  if (!Array.isArray(results.phoneProfiles)) results.phoneProfiles = [];
    if (!Array.isArray(results.postLinks)) results.postLinks = [];
    if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
    if (!results.sourceData.post || typeof results.sourceData.post !== 'object') results.sourceData.post = {};
    if (!Array.isArray(results.sourceData.post.phones)) results.sourceData.post.phones = [];
    if (!Array.isArray(results.sourceData.post.linkGroupZalos)) results.sourceData.post.linkGroupZalos = [];
    if (!Array.isArray(results.sourceData.post.uids)) results.sourceData.post.uids = [];
    if (!Array.isArray(results.sourceData.post.postLinks)) results.sourceData.post.postLinks = [];
    return results;
  }
  function normalizeKeywordText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  }
  function keywordList() {
    return String(vars.postKeywords || '').split(',').map(x => normalizeKeywordText(x.trim())).filter(Boolean);
  }
  function matchesContent(text) {
    if (!vars.isFindPostByKeywords) return true;
    const words = keywordList();
    if (words.length === 0) return true;
    const haystack = normalizeKeywordText(text);
    return words.some(word => haystack.includes(word));
  }
  function isMeaningAiEnabled() { return vars.isFindPostByContentAI === true && String(vars.postContentAI || '').trim().length > 0; }
  function createEmptyMeaningAiCheck() {
    return { ok: true, matched: true, checkResult: '', prompt: String(vars.postContentAI || ''), finalPrompt: '', rawResult: '', reason: '', error: '' };
  }
  function normalizeMeaningAiCheck(result) {
    if (result && result.unsupported) {
      return { ok: false, matched: false, checkResult: 'error', prompt: String(vars.postContentAI || ''), finalPrompt: '', rawResult: '', reason: 'Runtime chưa hỗ trợ helper callAIUsing', error: 'Runtime chưa hỗ trợ helper callAIUsing' };
    }
    const raw = result && typeof result === 'object' ? result : {};
    const checkResult = String(raw.checkResult || raw.check_result || (raw.ok === true ? (raw.matched === true ? 'matched' : 'not_matched') : 'error'));
    return { ok: raw.ok === true, matched: raw.matched === true, checkResult, prompt: String(raw.prompt || vars.postContentAI || ''), finalPrompt: String(raw.finalPrompt || raw.final_prompt || ''), rawResult: String(raw.rawResult || raw.raw_result || ''), reason: String(raw.reason || raw.error || ''), error: String(raw.error || '') };
  }
  async function checkMeaningAi(content, entityType) {
    if (!isMeaningAiEnabled()) return createEmptyMeaningAiCheck();
    const result = await checkMeaningAI({ contentText: String(content || ''), prompt: String(vars.postContentAI || ''), entityType });
    return normalizeMeaningAiCheck(result);
  }
  function isMeaningAiAccepted(aiCheck) { return !isMeaningAiEnabled() || (aiCheck && aiCheck.ok === true && aiCheck.matched === true); }
  function isMeaningAiFailed(aiCheck) { return isMeaningAiEnabled() && (!aiCheck || aiCheck.ok !== true); }
  function getMeaningAiMessage(aiCheck) {
    if (isMeaningAiFailed(aiCheck)) return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân');
    if (isMeaningAiEnabled() && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI';
    return 'Đúng ý nghĩa AI';
  }
  function buildFilterData(matchedKeyword, aiCheck) {
    const keywordEnabled = vars.isFindPostByKeywords === true && String(vars.postKeywords || '').trim().length > 0;
    const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : '');
    const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : '');
    return { keywordEnabled, keyword: keywordEnabled ? String(vars.postKeywords || '') : null, matchedKeyword: keywordEnabled ? matchedKeyword : null, aiPrompt: String(vars.postContentAI || '') || null, aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''), aiRawResult: rawResult, aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''), aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null, aiReason: reason || null, aiResult: rawResult || null };
  }
  function normalizePhone(value) {
    const raw = String(value || '').trim();
    const compact = raw.replace(/[\s.\-]/g, '');
    let digits = compact.replace(/[^\d+]/g, '');
    if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
    else if (digits.startsWith('84')) digits = '0' + digits.slice(2);
    digits = digits.replace(/\D/g, '');
    if (/^0[35789]\d{8}$/.test(digits)) return digits;
    return '';
  }
  function findPhones(text) {
    const matches = String(text || '').match(/(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}\b/g) || [];
    return matches.map(normalizePhone).filter(Boolean);
  }
  function findZaloLinks(text) {
    const matches = String(text || '').match(/(?:https?:\/\/)?zalo\.me\/g\/[a-z0-9]+/gi) || [];
    return matches.map(x => x.trim()).filter(Boolean);
  }
  function unique(arr) { return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean))); }
  function authorUidFromItem(item) {
    const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim();
    const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim();
    try {
      const url = new URL(rawHref, 'https://www.facebook.com');
      const parts = url.pathname.split('/').map(part => { try { return decodeURIComponent(part); } catch { return part; } }).map(part => part.trim()).filter(Boolean);
      const lowerParts = parts.map(part => part.toLowerCase());
      const firstPathPart = lowerParts[0] || '';
      if (firstPathPart === 'profile.php') {
        const id = url.searchParams.get('id');
        return id ? id.trim() : '';
      }
      const userIndex = lowerParts.indexOf('user');
      if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];
      if (firstPathPart === 'groups') return '';
      const blockedPathParts = new Set(['posts', 'permalink', 'permalink.php', 'story.php', 'photo.php', 'photos', 'watch', 'reel', 'videos', 'video.php']);
      if (lowerParts.some(part => blockedPathParts.has(part))) return '';
      if (parts.length === 1 && parts[0]) return parts[0];
    } catch {}
    return fallbackUid;
  }

  const results = ensureResults();
  const sourcePost = results.sourceData.post;
  const posts = Array.isArray(input.posts) ? input.posts : (Array.isArray(vars.findDataSearchPosts) ? vars.findDataSearchPosts : []);
  
let matchedPosts = 0;
const postFilterEnabled = (
  vars.isFindPostByKeywords === true && String(vars.postKeywords || '').trim().length > 0
) || (
  vars.isFindPostByContentAI === true && String(vars.postContentAI || '').trim().length > 0
);
const matchedPostIndexes = [];
vars.findDataPostFilterEnabled = postFilterEnabled;
vars.findDataMatchedPostIndexes = [];


  if (vars.findDataSearchHasPost) {
    for (let postLoopIndex = 0; postLoopIndex < posts.length; postLoopIndex++) {
    const post = posts[postLoopIndex];
      const content = String(post && post.content ? post.content : '');
      const postIndexForFilter = Math.max(1, Number(post && post.index ? post.index : postLoopIndex + 1));
      const contentMatches = matchesContent(content);
      const shouldExtractPostData = vars.isFindInPost || vars.isFindPostLink;
    const shouldFilterPostForComments = vars.isFindInComment === true && postFilterEnabled;
    const shouldEvaluatePostContent = shouldExtractPostData || shouldFilterPostForComments;
    const meaningAiCheck = shouldEvaluatePostContent && contentMatches ? await checkMeaningAi(content, 'post') : createEmptyMeaningAiCheck();
      const meaningAiAccepted = isMeaningAiAccepted(meaningAiCheck);
      const postAuthorUidForLog = authorUidFromItem(post);
      const postAuthorNameForLog = String(post && post.authorName ? post.authorName : '').trim();
      const postPhonesForLog = findPhones(content);
      const postZaloLinksForLog = findZaloLinks(content);
      const postLinksForLog = post && post.postLink ? [String(post.postLink)] : [];
      const postIndex = post && post.index ? post.index : null;
      const postUrl = String(post && post.postLink ? post.postLink : '');

      if (shouldEvaluatePostContent && !contentMatches) {
        await helpers.logRunEvent({ eventType: 'extract_post_data', eventName: 'Lấy thông tin bài post', targetType: 'post', status: 'skipped', isUserVisible: true, itemIndex: postIndex, targetUrl: postUrl, message: 'Không chứa keyword', extractedData: { entity: { type: 'post', url: postUrl, name: postAuthorNameForLog || null, uid: postAuthorUidForLog || null, contentText: content }, filters: buildFilterData(false, createEmptyMeaningAiCheck()), values: { phones: postPhonesForLog, zaloGroupLinks: postZaloLinksForLog, postLinks: postLinksForLog, uids: unique([postAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, authorName: postAuthorNameForLog, authorUrl: String(post && post.authorUrl ? post.authorUrl : ''), rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : ''), searchKeyword: vars.findDataSearchKeyword || '' } });
        continue;
      }

      if (shouldEvaluatePostContent && contentMatches && !meaningAiAccepted) {
        await helpers.logRunEvent({ eventType: 'extract_post_data', eventName: 'Lấy thông tin bài post', targetType: 'post', status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped', isUserVisible: true, itemIndex: postIndex, targetUrl: postUrl, message: getMeaningAiMessage(meaningAiCheck), extractedData: { entity: { type: 'post', url: postUrl, name: postAuthorNameForLog || null, uid: postAuthorUidForLog || null, contentText: content }, filters: buildFilterData(true, meaningAiCheck), values: { phones: postPhonesForLog, zaloGroupLinks: postZaloLinksForLog, postLinks: postLinksForLog, uids: unique([postAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, authorName: postAuthorNameForLog, authorUrl: String(post && post.authorUrl ? post.authorUrl : ''), rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : ''), searchKeyword: vars.findDataSearchKeyword || '' } });
        continue;
      }

      if (shouldEvaluatePostContent && contentMatches && meaningAiAccepted) {
        matchedPosts++;
      if (postFilterEnabled) matchedPostIndexes.push(postIndexForFilter);
        if (vars.isFindInPost && vars.isFindPhone) { results.phones.push(...postPhonesForLog); sourcePost.phones.push(...postPhonesForLog); for (const phone of postPhonesForLog) results.phoneProfiles.push({ phone, name: postAuthorNameForLog, uid: postAuthorUidForLog, url: String(post && post.authorUrl ? post.authorUrl : ''), source: 'post' }); }
        if (vars.isFindInPost && vars.isFindLinkGroupZalo) { results.linkGroupZalos.push(...postZaloLinksForLog); sourcePost.linkGroupZalos.push(...postZaloLinksForLog); }
        if (vars.isFindInPost && vars.isFindUid && postAuthorUidForLog) { results.uids.push(postAuthorUidForLog); sourcePost.uids.push(postAuthorUidForLog); results.uidProfiles.push({ uid: postAuthorUidForLog, name: postAuthorNameForLog, url: String(post && post.authorUrl ? post.authorUrl : ''), source: 'post' }); }
        if (vars.isFindPostLink) { results.postLinks.push(...postLinksForLog); sourcePost.postLinks.push(...postLinksForLog); }
        await helpers.logRunEvent({ eventType: 'extract_post_data', eventName: 'Lấy thông tin bài post', targetType: 'post', status: 'success', isUserVisible: true, itemIndex: postIndex, targetUrl: postUrl, message: 'Đã duyệt bài post #' + (postIndex || ''), extractedData: { entity: { type: 'post', url: postUrl, name: postAuthorNameForLog || null, uid: postAuthorUidForLog || null, contentText: content }, filters: buildFilterData(contentMatches, meaningAiCheck), values: { phones: postPhonesForLog, zaloGroupLinks: postZaloLinksForLog, postLinks: postLinksForLog, uids: unique([postAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, authorName: postAuthorNameForLog, authorUrl: String(post && post.authorUrl ? post.authorUrl : ''), rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : ''), searchKeyword: vars.findDataSearchKeyword || '' } });
      }
    }
  }

  results.phones = unique(results.phones); results.linkGroupZalos = unique(results.linkGroupZalos); results.uids = unique(results.uids); results.postLinks = unique(results.postLinks);
  sourcePost.phones = unique(sourcePost.phones); sourcePost.linkGroupZalos = unique(sourcePost.linkGroupZalos); sourcePost.uids = unique(sourcePost.uids); sourcePost.postLinks = unique(sourcePost.postLinks);
  vars.findDataMatchedPostIndexes = unique(matchedPostIndexes);
  vars.findDataPostFilterEnabled = postFilterEnabled;
  return { matchedPosts, phones: results.phones, linkGroupZalos: results.linkGroupZalos, uids: results.uids, postLinks: results.postLinks };
$v641$, updated_at = now()
 WHERE id = 2904 AND md5(code) = '023c452504d3e5c40b584fbb146c26bc';

UPDATE public.auto_blocks SET code = $v641$// Centralized AI find-data filter via ai_using.
const __aiFindDataUsingCode = "fb_collect_search_post_comments_ai_filter";
const __extractAIText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (Array.isArray(value)) return value.map(__extractAIText).filter(Boolean).join('\n').trim();
  if (typeof value === 'object') {
    const data = value;
    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result;
    if (direct !== undefined && direct !== null && direct !== value) {
      const directText = __extractAIText(direct);
      if (directText) return directText;
    }
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value || '').trim();
};
const __callCentralAI = async (usingCode, payload) => {
  if (!usingCode) throw new Error('Thiếu mã cấu hình AI');
  if (typeof helpers.callAIUsing !== 'function') throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  const result = await helpers.callAIUsing(usingCode, payload || {});
  if (result && result.unsupported) throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : 'AI lỗi'));
  return result;
};
const __splitMeaningTraits = (prompt) => {
  const lines = String(prompt || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [String(prompt || '').trim()].filter(Boolean);
};
const __extractJsonText = (raw) => {
  const trimmed = String(raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : trimmed).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
};
const checkMeaningAI = async (options = {}) => {
  const prompt = String(options.prompt || '').trim();
  const contentText = String(options.contentText || '').trim();
  const entityType = String(options.entityType || 'content').trim() || 'content';
  const traits = __splitMeaningTraits(prompt);
  const criteria = traits.map((trait, index) => (index + 1) + '. ' + trait).join('\n');
  const result = await __callCentralAI(__aiFindDataUsingCode, {
    prompt,
    criteria,
    entity_type: entityType,
    entityType,
    content: JSON.stringify(contentText),
    contentText
  });
  const rawResult = __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));
  let matched = false;
  let reason = '';
  try {
    const parsed = JSON.parse(__extractJsonText(rawResult));
    matched = parsed.matched === true || parsed.match === true || String(parsed.result || parsed.checkResult || '').toLowerCase() === 'matched';
    reason = String(parsed.reason || parsed.explanation || parsed.message || '').trim();
  } catch {
    const normalized = rawResult.toLowerCase();
    matched = normalized.includes('matched') || normalized.includes('true') || normalized.includes('phù hợp') || normalized.includes('phu hop') || normalized.includes('có');
    reason = rawResult.slice(0, 500);
  }
  return {
    ok: true,
    matched,
    checkResult: matched ? 'matched' : 'not_matched',
    prompt,
    finalPrompt: String(result.renderedUserPrompt || result.rendered_user_prompt || ''),
    rawResult,
    reason,
    provider: result.provider || '',
    model: result.model || ''
  };
};

  if (!vars.findDataSearchHasPost || vars.isFindInComment !== true) {
    vars.findDataSearchComments = [];
    return { commentItems: [] };
  }

  const selectors = {
    posts: await helpers.element('fb_search_post_in_uid'),
    commentButton: await helpers.element('fb_comment_in_post_btn'),
    mostRelevant: await helpers.element('fb_most_relevant_btn'),
    allComments: await helpers.element('fb_all_comments_btn'),
    newestComments: await helpers.element('fb_newest_comments_btn'),
    dialog: await helpers.element('fb_dialog'),
    commentElement: await helpers.element('fb_cmt_element_full'),
    uidInComment: await helpers.element('fb_uid_in_cmt_element'),
    contentInComment: await helpers.element('fb_content_in_cmt_element'),
    closeDialog: await helpers.element('fb_close_dialog_btn')
  };
  const postLimit = Math.max(1, Number(vars.countSearchPostFindData || vars.countPostFindData || 10));
  const commentLimit = Math.max(1, Number(vars.countCommentFindData || 30));
  const sortType = String(vars.sortTypeComment || 'most_relevant');
const postFilterEnabled = vars.findDataPostFilterEnabled === true;
const matchedPostIndexesForComments = Array.isArray(vars.findDataMatchedPostIndexes)
  ? vars.findDataMatchedPostIndexes.map(value => Math.max(1, Number(value) || 0)).filter(Boolean)
  : [];

  const commentResult = await page.evaluate(String.raw`
    const selectors = __args[0];
    const postLimit = __args[1];
    const commentLimit = __args[2];
    const sortType = __args[3];
    const postFilterEnabled = __args[4] === true;
    const matchedPostIndexes = new Set((Array.isArray(__args[5]) ? __args[5] : []).map(value => Math.max(1, Number(value) || 0)).filter(Boolean));
    function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    function norm(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
    function isVisible(el) { if (!el) return false; const style = window.getComputedStyle(el); if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false; const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }
    function xpathAll(xpath, root) { const out = []; if (!xpath) return out; try { const result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i)); } catch {} return out.filter(Boolean); }
    function first(xpath, root) { return xpathAll(xpath, root)[0] || null; }
    function clickSynthetic(el) { if (!el) return false; try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {} const init = { bubbles: true, cancelable: true, view: window }; try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {} try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {} try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {} try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {} try { el.click(); return true; } catch {} return false; }
    async function waitFor(fn, timeoutMs) { const started = Date.now(); while (Date.now() - started < timeoutMs) { const value = fn(); if (value) return value; await delay(300); } return null; }
    function extractUid(href) { if (!href) return ''; try { const url = new URL(href, location.href); const id = url.searchParams.get('id'); if (id) return id; const parts = url.pathname.split('/').filter(Boolean); const userIndex = parts.indexOf('user'); if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1]; return parts[parts.length - 1] || ''; } catch { return String(href || '').trim(); } }
    function commentContentOf(comment, authorLink, messageXpath) { const candidates = xpathAll(messageXpath, comment).filter(isVisible).filter(el => !authorLink || el !== authorLink && !(el.contains && el.contains(authorLink))).map(el => (el.innerText || el.textContent || '').trim()).filter(Boolean); return candidates[0] || (comment.innerText || comment.textContent || '').trim(); }
    function findPostElementsFallback() { const main = document.querySelector('[role="main"]') || document.body; const byArticle = Array.from(main.querySelectorAll('[role="article"]')).filter(isVisible).filter(el => { const text = norm(el.innerText || el.textContent || ''); return text.includes('Bình luận') || text.includes('Comment') || text.includes('Chia sẻ') || text.includes('Share'); }); if (byArticle.length > 0) return byArticle; return []; }
    function getPostElements() { const fromElement = xpathAll(selectors.posts).filter(isVisible); return fromElement.length > 0 ? fromElement : findPostElementsFallback(); }

    const rows = [];
    const postCommentStats = [];
    const posts = getPostElements().slice(0, postLimit);
    for (let p = 0; p < posts.length; p++) {
      const post = posts[p];
      const postStat = { postIndex: p + 1, opened: false, sorted: sortType === 'most_relevant', commentsCount: 0, error: '', filteredByPostContent: false };
      if (postFilterEnabled && !matchedPostIndexes.has(p + 1)) {
        postStat.filteredByPostContent = true;
        postStat.error = 'Không đạt điều kiện nội dung bài viết';
        postCommentStats.push(postStat);
        continue;
      }
      try {
        post.scrollIntoView(true);
        await delay(700);
        const button = first(selectors.commentButton, post) || Array.from(post.querySelectorAll('[role="button"]')).filter(isVisible).find(btn => { const text = norm(btn.innerText || btn.textContent || btn.getAttribute('aria-label')); return text === 'Bình luận' || text === 'Comment'; });
        if (!button) { postStat.error = 'Không tìm thấy nút comment'; continue; }
        clickSynthetic(button);
        postStat.opened = true;
        await delay(2000);
        let root = await waitFor(() => first(selectors.dialog, document), 5000);
        if (!root) root = document.documentElement;
        if (sortType !== 'most_relevant') {
          postStat.sorted = false;
          const sortButton = first(selectors.mostRelevant, root) || first(selectors.mostRelevant, document);
          if (sortButton) {
            clickSynthetic(sortButton); await delay(800);
            const optionXpath = sortType === 'newest' ? selectors.newestComments : selectors.allComments;
            const option = first(optionXpath, document);
            if (option) { clickSynthetic(option); postStat.sorted = true; await delay(2000); }
            else { postStat.error = 'Không tìm thấy lựa chọn sắp xếp comment'; }
          } else { postStat.error = 'Không tìm thấy nút sắp xếp comment'; }
        }
        let comments = xpathAll(selectors.commentElement, root);
        const startedAt = Date.now();
        let stableCount = 0;
        while (comments.length < commentLimit && Date.now() - startedAt < 90000 && stableCount < 3) {
          const oldCount = comments.length;
          if (comments.length > 0) comments[comments.length - 1].scrollIntoView(true);
          await delay(1500);
          comments = xpathAll(selectors.commentElement, root);
          stableCount = comments.length <= oldCount ? stableCount + 1 : 0;
        }
        const selectedComments = comments.slice(0, commentLimit);
        postStat.commentsCount = selectedComments.length;
        selectedComments.forEach((comment, i) => {
          const link = first(selectors.uidInComment, comment);
          const href = link ? (link.href || link.getAttribute('href') || '') : '';
          const authorName = link ? (link.innerText || link.textContent || '').trim() : '';
          const content = commentContentOf(comment, link, selectors.contentInComment);
          rows.push({ postIndex: p + 1, commentIndex: i + 1, content, authorName, authorUrl: href, authorUid: extractUid(href) });
        });
      } catch (err) { postStat.error = err && err.message ? err.message : String(err || 'Lỗi mở comment'); }
      finally { const closeButton = first(selectors.closeDialog, document); if (closeButton) { clickSynthetic(closeButton); await delay(1000); } postCommentStats.push(postStat); }
    }
    return { rows, postCommentStats };
  `, selectors, postLimit, commentLimit, sortType, postFilterEnabled, matchedPostIndexesForComments);

  const commentItems = Array.isArray(commentResult) ? commentResult : (commentResult && Array.isArray(commentResult.rows) ? commentResult.rows : []);
  const commentPostStats = commentResult && Array.isArray(commentResult.postCommentStats) ? commentResult.postCommentStats : [];
  vars.findDataSearchComments = commentItems;
  helpers.log('Đã tải ' + vars.findDataSearchComments.length + ' comment từ search');

  function ensureResults() { if (!vars.findDataResults || typeof vars.findDataResults !== 'object') vars.findDataResults = {}; const results = vars.findDataResults; if (!Array.isArray(results.phones)) results.phones = []; if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = []; if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.uidProfiles)) results.uidProfiles = [];
  if (!Array.isArray(results.phoneProfiles)) results.phoneProfiles = []; if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {}; if (!results.sourceData.comment || typeof results.sourceData.comment !== 'object') results.sourceData.comment = {}; if (!Array.isArray(results.sourceData.comment.phones)) results.sourceData.comment.phones = []; if (!Array.isArray(results.sourceData.comment.linkGroupZalos)) results.sourceData.comment.linkGroupZalos = []; if (!Array.isArray(results.sourceData.comment.uids)) results.sourceData.comment.uids = []; return results; }
  function normalizeKeywordText(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase(); }
  function keywordList() { return String(vars.commentKeywords || '').split(',').map(x => normalizeKeywordText(x.trim())).filter(Boolean); }
  function matchesContent(text) { if (!vars.isFindCommentByKeywords) return true; const words = keywordList(); if (words.length === 0) return true; const haystack = normalizeKeywordText(text); return words.some(word => haystack.includes(word)); }
  function isMeaningAiEnabled() { return vars.isFindCommentByContentAI === true && String(vars.commentContentAI || '').trim().length > 0; }
  function createEmptyMeaningAiCheck() { return { ok: true, matched: true, checkResult: '', prompt: String(vars.commentContentAI || ''), finalPrompt: '', rawResult: '', reason: '', error: '' }; }
  function normalizeMeaningAiCheck(result) { if (result && result.unsupported) return { ok: false, matched: false, checkResult: 'error', prompt: String(vars.commentContentAI || ''), finalPrompt: '', rawResult: '', reason: 'Runtime chưa hỗ trợ helper callAIUsing', error: 'Runtime chưa hỗ trợ helper callAIUsing' }; const raw = result && typeof result === 'object' ? result : {}; const checkResult = String(raw.checkResult || raw.check_result || (raw.ok === true ? (raw.matched === true ? 'matched' : 'not_matched') : 'error')); return { ok: raw.ok === true, matched: raw.matched === true, checkResult, prompt: String(raw.prompt || vars.commentContentAI || ''), finalPrompt: String(raw.finalPrompt || raw.final_prompt || ''), rawResult: String(raw.rawResult || raw.raw_result || ''), reason: String(raw.reason || raw.error || ''), error: String(raw.error || '') }; }
  async function checkMeaningAi(content, entityType) { if (!isMeaningAiEnabled()) return createEmptyMeaningAiCheck(); const result = await checkMeaningAI({ contentText: String(content || ''), prompt: String(vars.commentContentAI || ''), entityType }); return normalizeMeaningAiCheck(result); }
  function isMeaningAiAccepted(aiCheck) { return !isMeaningAiEnabled() || (aiCheck && aiCheck.ok === true && aiCheck.matched === true); }
  function isMeaningAiFailed(aiCheck) { return isMeaningAiEnabled() && (!aiCheck || aiCheck.ok !== true); }
  function getMeaningAiMessage(aiCheck) { if (isMeaningAiFailed(aiCheck)) return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân'); if (isMeaningAiEnabled() && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI'; return 'Đúng ý nghĩa AI'; }
  function buildFilterData(matchedKeyword, aiCheck) { const keywordEnabled = vars.isFindCommentByKeywords === true && String(vars.commentKeywords || '').trim().length > 0; const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : ''); const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : ''); return { keywordEnabled, keyword: keywordEnabled ? String(vars.commentKeywords || '') : null, matchedKeyword: keywordEnabled ? matchedKeyword : null, aiPrompt: String(vars.commentContentAI || '') || null, aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''), aiRawResult: rawResult, aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''), aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null, aiReason: reason || null, aiResult: rawResult || null }; }
  function normalizePhone(value) { const raw = String(value || '').trim(); const compact = raw.replace(/[\s.\-]/g, ''); let digits = compact.replace(/[^\d+]/g, ''); if (digits.startsWith('+84')) digits = '0' + digits.slice(3); else if (digits.startsWith('84')) digits = '0' + digits.slice(2); digits = digits.replace(/\D/g, ''); if (/^0[35789]\d{8}$/.test(digits)) return digits; return ''; }
  function findPhones(text) { const matches = String(text || '').match(/(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}\b/g) || []; return matches.map(normalizePhone).filter(Boolean); }
  function findZaloLinks(text) { const matches = String(text || '').match(/(?:https?:\/\/)?zalo\.me\/g\/[a-z0-9]+/gi) || []; return matches.map(x => x.trim()).filter(Boolean); }
  function unique(arr) { return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean))); }
  function authorUidFromItem(item) { const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim(); const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim(); try { const url = new URL(rawHref, 'https://www.facebook.com'); const parts = url.pathname.split('/').map(part => { try { return decodeURIComponent(part); } catch { return part; } }).map(part => part.trim()).filter(Boolean); const lowerParts = parts.map(part => part.toLowerCase()); const firstPathPart = lowerParts[0] || ''; if (firstPathPart === 'profile.php') { const id = url.searchParams.get('id'); return id ? id.trim() : ''; } const userIndex = lowerParts.indexOf('user'); if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1]; if (firstPathPart === 'groups') return ''; const blockedPathParts = new Set(['posts', 'permalink', 'permalink.php', 'story.php', 'photo.php', 'photos', 'watch', 'reel', 'videos', 'video.php']); if (lowerParts.some(part => blockedPathParts.has(part))) return ''; if (parts.length === 1 && parts[0]) return parts[0]; } catch {} return fallbackUid; }

  const results = ensureResults();
  const sourceComment = results.sourceData.comment;
  const commentSourcePosts = Array.isArray(vars.findDataSearchPosts) ? vars.findDataSearchPosts : [];
  const commentsByPost = new Map();
  for (const comment of vars.findDataSearchComments) { const postIndex = Math.max(1, Number(comment && comment.postIndex ? comment.postIndex : 0)); if (!commentsByPost.has(postIndex)) commentsByPost.set(postIndex, []); commentsByPost.get(postIndex).push(comment); }
  const commentLogEvents = [];
  let matchedComments = 0;
  let globalCommentIndex = 0;

  for (const rawStat of commentPostStats) {
    const stat = rawStat && typeof rawStat === 'object' ? rawStat : {};
    const postIndex = Math.max(1, Number(stat.postIndex || 0));
    const commentsCount = Math.max(0, Number(stat.commentsCount || 0));
    const opened = stat.opened === true;
    const sorted = stat.sorted === true;
    const error = String(stat.error || '').trim();
    const sourcePost = commentSourcePosts[postIndex - 1] || {};
    const postUrl = String(sourcePost && sourcePost.postLink ? sourcePost.postLink : '');
    const commentsForPost = commentsByPost.get(postIndex) || [];

    commentLogEvents.push({ eventType: 'open_comments', eventName: 'Mở comment', targetType: 'comment', status: opened ? 'success' : 'skipped', isUserVisible: false, xpath: selectors.commentButton, itemIndex: postIndex, targetUrl: postUrl, message: opened ? 'Đã mở comment của bài post #' + postIndex : 'Bỏ qua mở comment của bài post #' + postIndex, debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error, searchKeyword: vars.findDataSearchKeyword || '' } });
    if (sortType !== 'most_relevant' && opened) commentLogEvents.push({ eventType: 'sort_comments', eventName: 'Sắp xếp comment', targetType: 'comment', status: sorted ? 'success' : 'failed', isUserVisible: false, itemIndex: postIndex, targetUrl: postUrl, message: sorted ? 'Đã đổi sắp xếp comment của bài post #' + postIndex : (error || 'Không sắp xếp được comment của bài post #' + postIndex), debugData: { sortType, postIndex, postUrl, error, selectors: { sortButton: selectors.mostRelevant, allComments: selectors.allComments, newestComments: selectors.newestComments }, searchKeyword: vars.findDataSearchKeyword || '' } });
    commentLogEvents.push({ eventType: 'collect_comments', eventName: 'Lấy danh sách comment', targetType: 'comment', status: opened ? 'success' : 'skipped', isUserVisible: true, xpath: selectors.commentElement, elementCount: commentsCount, itemIndex: postIndex, targetUrl: postUrl, message: 'Bài post #' + postIndex + ': lấy được ' + commentsCount + ' comment', debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error, searchKeyword: vars.findDataSearchKeyword || '' } });

    for (const comment of commentsForPost) {
      globalCommentIndex++;
      const content = String(comment && comment.content ? comment.content : '');
      const contentMatches = matchesContent(content);
      const meaningAiCheck = vars.isFindInComment && contentMatches ? await checkMeaningAi(content, 'comment') : createEmptyMeaningAiCheck();
      const meaningAiAccepted = isMeaningAiAccepted(meaningAiCheck);
      const commentAuthorUidForLog = authorUidFromItem(comment);
      const commentAuthorNameForLog = String(comment && comment.authorName ? comment.authorName : '').trim();
      const commentPhonesForLog = findPhones(content);
      const commentZaloLinksForLog = findZaloLinks(content);
      const commentPostLinksForLog = postUrl ? [postUrl] : [];
      const commentIndexInPost = Math.max(1, Number(comment && comment.commentIndex ? comment.commentIndex : 0));
      const authorUrl = String(comment && comment.authorUrl ? comment.authorUrl : '');

      if (vars.isFindInComment && contentMatches && !meaningAiAccepted) {
        commentLogEvents.push({ eventType: 'extract_comment_data', eventName: 'Lấy thông tin comment', targetType: 'comment', status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped', isUserVisible: true, itemIndex: commentIndexInPost, targetUrl: authorUrl, message: getMeaningAiMessage(meaningAiCheck), extractedData: { entity: { type: 'comment', url: authorUrl, name: commentAuthorNameForLog || null, uid: commentAuthorUidForLog || null, contentText: content }, filters: buildFilterData(true, meaningAiCheck), values: { phones: commentPhonesForLog, zaloGroupLinks: commentZaloLinksForLog, postLinks: commentPostLinksForLog, uids: unique([commentAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, commentIndexInPost, globalCommentIndex, postUrl, authorName: commentAuthorNameForLog, authorUrl, searchKeyword: vars.findDataSearchKeyword || '' } });
        continue;
      }
      if (vars.isFindInComment && contentMatches && meaningAiAccepted) {
        matchedComments++;
        if (vars.isFindPhone) { results.phones.push(...commentPhonesForLog); sourceComment.phones.push(...commentPhonesForLog); for (const phone of commentPhonesForLog) results.phoneProfiles.push({ phone, name: commentAuthorNameForLog, uid: commentAuthorUidForLog, url: authorUrl, source: 'comment' }); }
        if (vars.isFindLinkGroupZalo) { results.linkGroupZalos.push(...commentZaloLinksForLog); sourceComment.linkGroupZalos.push(...commentZaloLinksForLog); }
        if (vars.isFindUid && commentAuthorUidForLog) { results.uids.push(commentAuthorUidForLog); sourceComment.uids.push(commentAuthorUidForLog); results.uidProfiles.push({ uid: commentAuthorUidForLog, name: commentAuthorNameForLog, url: authorUrl, source: 'comment' }); }
        commentLogEvents.push({ eventType: 'extract_comment_data', eventName: 'Lấy thông tin comment', targetType: 'comment', status: 'success', isUserVisible: true, itemIndex: commentIndexInPost, targetUrl: authorUrl, message: 'Đã duyệt comment #' + commentIndexInPost, extractedData: { entity: { type: 'comment', url: authorUrl, name: commentAuthorNameForLog || null, uid: commentAuthorUidForLog || null, contentText: content }, filters: buildFilterData(contentMatches, meaningAiCheck), values: { phones: commentPhonesForLog, zaloGroupLinks: commentZaloLinksForLog, postLinks: commentPostLinksForLog, uids: unique([commentAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, commentIndexInPost, globalCommentIndex, postUrl, authorName: commentAuthorNameForLog, authorUrl, searchKeyword: vars.findDataSearchKeyword || '' } });
      } else if (vars.isFindInComment && !contentMatches) {
        commentLogEvents.push({ eventType: 'extract_comment_data', eventName: 'Lấy thông tin comment', targetType: 'comment', status: 'skipped', isUserVisible: true, itemIndex: commentIndexInPost, targetUrl: authorUrl, message: 'Không chứa keyword', extractedData: { entity: { type: 'comment', url: authorUrl, name: commentAuthorNameForLog || null, uid: commentAuthorUidForLog || null, contentText: content }, filters: buildFilterData(false, createEmptyMeaningAiCheck()), values: { phones: commentPhonesForLog, zaloGroupLinks: commentZaloLinksForLog, postLinks: commentPostLinksForLog, uids: unique([commentAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, commentIndexInPost, globalCommentIndex, postUrl, authorName: commentAuthorNameForLog, authorUrl, searchKeyword: vars.findDataSearchKeyword || '' } });
      }
    }
  }
  if (commentLogEvents.length > 0) commentLogEvents.push({ eventType: 'collect_comments_summary', eventName: 'Tổng kết comment', targetType: 'comment', status: 'success', isUserVisible: true, elementCount: vars.findDataSearchComments.length, message: 'Tổng cộng lấy được ' + vars.findDataSearchComments.length + ' comment từ search', debugData: { postLimit, commentLimit, sortType, matchedComments, searchKeyword: vars.findDataSearchKeyword || '' } });
  await helpers.logRunEvents(commentLogEvents);
  results.phones = unique(results.phones); results.linkGroupZalos = unique(results.linkGroupZalos); results.uids = unique(results.uids); sourceComment.phones = unique(sourceComment.phones); sourceComment.linkGroupZalos = unique(sourceComment.linkGroupZalos); sourceComment.uids = unique(sourceComment.uids);
  vars.findDataSearchMatchedComments = matchedComments;
  return { commentItems: vars.findDataSearchComments, commentPostStats, matchedComments };
$v641$, updated_at = now()
 WHERE id = 2719 AND md5(code) = '9d2678eeb3ef2ca56bf86a5f442958f0';

UPDATE public.auto_blocks SET code = $v641$// Centralized AI find-data filter via ai_using.
const __aiFindDataUsingCode = "fb_collect_search_post_comments_ai_filter";
const __extractAIText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (Array.isArray(value)) return value.map(__extractAIText).filter(Boolean).join('\n').trim();
  if (typeof value === 'object') {
    const data = value;
    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result;
    if (direct !== undefined && direct !== null && direct !== value) {
      const directText = __extractAIText(direct);
      if (directText) return directText;
    }
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value || '').trim();
};
const __callCentralAI = async (usingCode, payload) => {
  if (!usingCode) throw new Error('Thiếu mã cấu hình AI');
  if (typeof helpers.callAIUsing !== 'function') throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  const result = await helpers.callAIUsing(usingCode, payload || {});
  if (result && result.unsupported) throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : 'AI lỗi'));
  return result;
};
const __splitMeaningTraits = (prompt) => {
  const lines = String(prompt || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [String(prompt || '').trim()].filter(Boolean);
};
const __extractJsonText = (raw) => {
  const trimmed = String(raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : trimmed).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
};
const checkMeaningAI = async (options = {}) => {
  const prompt = String(options.prompt || '').trim();
  const contentText = String(options.contentText || '').trim();
  const entityType = String(options.entityType || 'content').trim() || 'content';
  const traits = __splitMeaningTraits(prompt);
  const criteria = traits.map((trait, index) => (index + 1) + '. ' + trait).join('\n');
  const result = await __callCentralAI(__aiFindDataUsingCode, {
    prompt,
    criteria,
    entity_type: entityType,
    entityType,
    content: JSON.stringify(contentText),
    contentText
  });
  const rawResult = __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));
  let matched = false;
  let reason = '';
  try {
    const parsed = JSON.parse(__extractJsonText(rawResult));
    matched = parsed.matched === true || parsed.match === true || String(parsed.result || parsed.checkResult || '').toLowerCase() === 'matched';
    reason = String(parsed.reason || parsed.explanation || parsed.message || '').trim();
  } catch {
    const normalized = rawResult.toLowerCase();
    matched = normalized.includes('matched') || normalized.includes('true') || normalized.includes('phù hợp') || normalized.includes('phu hop') || normalized.includes('có');
    reason = rawResult.slice(0, 500);
  }
  return {
    ok: true,
    matched,
    checkResult: matched ? 'matched' : 'not_matched',
    prompt,
    finalPrompt: String(result.renderedUserPrompt || result.rendered_user_prompt || ''),
    rawResult,
    reason,
    provider: result.provider || '',
    model: result.model || ''
  };
};

  if (!vars.findDataSearchHasPost || vars.isFindInComment !== true) {
    vars.findDataSearchComments = [];
    return { commentItems: [] };
  }

  const selectors = {
    posts: await helpers.element('fb_search_post_in_uid'),
    commentButton: await helpers.element('fb_comment_in_post_btn'),
    mostRelevant: await helpers.element('fb_most_relevant_btn'),
    allComments: await helpers.element('fb_all_comments_btn'),
    newestComments: await helpers.element('fb_newest_comments_btn'),
    dialog: await helpers.element('fb_dialog'),
    commentElement: await helpers.element('fb_cmt_element_full'),
    uidInComment: await helpers.element('fb_uid_in_cmt_element'),
    contentInComment: await helpers.element('fb_content_in_cmt_element'),
    closeDialog: await helpers.element('fb_close_dialog_btn')
  };
  const postLimit = Math.max(1, Number(vars.countSearchPostFindData || vars.countPostFindData || 10));
  const commentLimit = Math.max(1, Number(vars.countCommentFindData || 30));
  const sortType = String(vars.sortTypeComment || 'most_relevant');
const postFilterEnabled = vars.findDataPostFilterEnabled === true;
const matchedPostIndexesForComments = Array.isArray(vars.findDataMatchedPostIndexes)
  ? vars.findDataMatchedPostIndexes.map(value => Math.max(1, Number(value) || 0)).filter(Boolean)
  : [];

  const commentResult = await page.evaluate(String.raw`
    const selectors = __args[0];
    const postLimit = __args[1];
    const commentLimit = __args[2];
    const sortType = __args[3];
    const postFilterEnabled = __args[4] === true;
    const matchedPostIndexes = new Set((Array.isArray(__args[5]) ? __args[5] : []).map(value => Math.max(1, Number(value) || 0)).filter(Boolean));
    function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    function norm(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
    function isVisible(el) { if (!el) return false; const style = window.getComputedStyle(el); if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false; const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }
    function xpathAll(xpath, root) { const out = []; if (!xpath) return out; try { const result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i)); } catch {} return out.filter(Boolean); }
    function first(xpath, root) { return xpathAll(xpath, root)[0] || null; }
    function clickSynthetic(el) { if (!el) return false; try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {} const init = { bubbles: true, cancelable: true, view: window }; try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {} try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {} try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {} try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {} try { el.click(); return true; } catch {} return false; }
    async function waitFor(fn, timeoutMs) { const started = Date.now(); while (Date.now() - started < timeoutMs) { const value = fn(); if (value) return value; await delay(300); } return null; }
    function extractUid(href) { if (!href) return ''; try { const url = new URL(href, location.href); const id = url.searchParams.get('id'); if (id) return id; const parts = url.pathname.split('/').filter(Boolean); const userIndex = parts.indexOf('user'); if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1]; return parts[parts.length - 1] || ''; } catch { return String(href || '').trim(); } }
    function commentContentOf(comment, authorLink, messageXpath) { const candidates = xpathAll(messageXpath, comment).filter(isVisible).filter(el => !authorLink || el !== authorLink && !(el.contains && el.contains(authorLink))).map(el => (el.innerText || el.textContent || '').trim()).filter(Boolean); return candidates[0] || (comment.innerText || comment.textContent || '').trim(); }
    function findPostElementsFallback() { const main = document.querySelector('[role="main"]') || document.body; const byArticle = Array.from(main.querySelectorAll('[role="article"]')).filter(isVisible).filter(el => { const text = norm(el.innerText || el.textContent || ''); return text.includes('Bình luận') || text.includes('Comment') || text.includes('Chia sẻ') || text.includes('Share'); }); if (byArticle.length > 0) return byArticle; return []; }
    function getPostElements() { const fromElement = xpathAll(selectors.posts).filter(isVisible); return fromElement.length > 0 ? fromElement : findPostElementsFallback(); }

    const rows = [];
    const postCommentStats = [];
    const posts = getPostElements().slice(0, postLimit);
    for (let p = 0; p < posts.length; p++) {
      const post = posts[p];
      const postStat = { postIndex: p + 1, opened: false, sorted: sortType === 'most_relevant', commentsCount: 0, error: '', filteredByPostContent: false };
      if (postFilterEnabled && !matchedPostIndexes.has(p + 1)) {
        postStat.filteredByPostContent = true;
        postStat.error = 'Không đạt điều kiện nội dung bài viết';
        postCommentStats.push(postStat);
        continue;
      }
      try {
        post.scrollIntoView(true);
        await delay(700);
        const button = first(selectors.commentButton, post) || Array.from(post.querySelectorAll('[role="button"]')).filter(isVisible).find(btn => { const text = norm(btn.innerText || btn.textContent || btn.getAttribute('aria-label')); return text === 'Bình luận' || text === 'Comment'; });
        if (!button) { postStat.error = 'Không tìm thấy nút comment'; continue; }
        clickSynthetic(button);
        postStat.opened = true;
        await delay(2000);
        let root = await waitFor(() => first(selectors.dialog, document), 5000);
        if (!root) root = document.documentElement;
        if (sortType !== 'most_relevant') {
          postStat.sorted = false;
          const sortButton = first(selectors.mostRelevant, root) || first(selectors.mostRelevant, document);
          if (sortButton) {
            clickSynthetic(sortButton); await delay(800);
            const optionXpath = sortType === 'newest' ? selectors.newestComments : selectors.allComments;
            const option = first(optionXpath, document);
            if (option) { clickSynthetic(option); postStat.sorted = true; await delay(2000); }
            else { postStat.error = 'Không tìm thấy lựa chọn sắp xếp comment'; }
          } else { postStat.error = 'Không tìm thấy nút sắp xếp comment'; }
        }
        let comments = xpathAll(selectors.commentElement, root);
        const startedAt = Date.now();
        let stableCount = 0;
        while (comments.length < commentLimit && Date.now() - startedAt < 90000 && stableCount < 3) {
          const oldCount = comments.length;
          if (comments.length > 0) comments[comments.length - 1].scrollIntoView(true);
          await delay(1500);
          comments = xpathAll(selectors.commentElement, root);
          stableCount = comments.length <= oldCount ? stableCount + 1 : 0;
        }
        const selectedComments = comments.slice(0, commentLimit);
        postStat.commentsCount = selectedComments.length;
        selectedComments.forEach((comment, i) => {
          const link = first(selectors.uidInComment, comment);
          const href = link ? (link.href || link.getAttribute('href') || '') : '';
          const authorName = link ? (link.innerText || link.textContent || '').trim() : '';
          const content = commentContentOf(comment, link, selectors.contentInComment);
          rows.push({ postIndex: p + 1, commentIndex: i + 1, content, authorName, authorUrl: href, authorUid: extractUid(href) });
        });
      } catch (err) { postStat.error = err && err.message ? err.message : String(err || 'Lỗi mở comment'); }
      finally { const closeButton = first(selectors.closeDialog, document); if (closeButton) { clickSynthetic(closeButton); await delay(1000); } postCommentStats.push(postStat); }
    }
    return { rows, postCommentStats };
  `, selectors, postLimit, commentLimit, sortType, postFilterEnabled, matchedPostIndexesForComments);

  const commentItems = Array.isArray(commentResult) ? commentResult : (commentResult && Array.isArray(commentResult.rows) ? commentResult.rows : []);
  const commentPostStats = commentResult && Array.isArray(commentResult.postCommentStats) ? commentResult.postCommentStats : [];
  vars.findDataSearchComments = commentItems;
  helpers.log('Đã tải ' + vars.findDataSearchComments.length + ' comment từ search');

  function ensureResults() { if (!vars.findDataResults || typeof vars.findDataResults !== 'object') vars.findDataResults = {}; const results = vars.findDataResults; if (!Array.isArray(results.phones)) results.phones = []; if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = []; if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.uidProfiles)) results.uidProfiles = [];
  if (!Array.isArray(results.phoneProfiles)) results.phoneProfiles = []; if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {}; if (!results.sourceData.comment || typeof results.sourceData.comment !== 'object') results.sourceData.comment = {}; if (!Array.isArray(results.sourceData.comment.phones)) results.sourceData.comment.phones = []; if (!Array.isArray(results.sourceData.comment.linkGroupZalos)) results.sourceData.comment.linkGroupZalos = []; if (!Array.isArray(results.sourceData.comment.uids)) results.sourceData.comment.uids = []; return results; }
  function normalizeKeywordText(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase(); }
  function keywordList() { return String(vars.commentKeywords || '').split(',').map(x => normalizeKeywordText(x.trim())).filter(Boolean); }
  function matchesContent(text) { if (!vars.isFindCommentByKeywords) return true; const words = keywordList(); if (words.length === 0) return true; const haystack = normalizeKeywordText(text); return words.some(word => haystack.includes(word)); }
  function isMeaningAiEnabled() { return vars.isFindCommentByContentAI === true && String(vars.commentContentAI || '').trim().length > 0; }
  function createEmptyMeaningAiCheck() { return { ok: true, matched: true, checkResult: '', prompt: String(vars.commentContentAI || ''), finalPrompt: '', rawResult: '', reason: '', error: '' }; }
  function normalizeMeaningAiCheck(result) { if (result && result.unsupported) return { ok: false, matched: false, checkResult: 'error', prompt: String(vars.commentContentAI || ''), finalPrompt: '', rawResult: '', reason: 'Runtime chưa hỗ trợ helper callAIUsing', error: 'Runtime chưa hỗ trợ helper callAIUsing' }; const raw = result && typeof result === 'object' ? result : {}; const checkResult = String(raw.checkResult || raw.check_result || (raw.ok === true ? (raw.matched === true ? 'matched' : 'not_matched') : 'error')); return { ok: raw.ok === true, matched: raw.matched === true, checkResult, prompt: String(raw.prompt || vars.commentContentAI || ''), finalPrompt: String(raw.finalPrompt || raw.final_prompt || ''), rawResult: String(raw.rawResult || raw.raw_result || ''), reason: String(raw.reason || raw.error || ''), error: String(raw.error || '') }; }
  async function checkMeaningAi(content, entityType) { if (!isMeaningAiEnabled()) return createEmptyMeaningAiCheck(); const result = await checkMeaningAI({ contentText: String(content || ''), prompt: String(vars.commentContentAI || ''), entityType }); return normalizeMeaningAiCheck(result); }
  function isMeaningAiAccepted(aiCheck) { return !isMeaningAiEnabled() || (aiCheck && aiCheck.ok === true && aiCheck.matched === true); }
  function isMeaningAiFailed(aiCheck) { return isMeaningAiEnabled() && (!aiCheck || aiCheck.ok !== true); }
  function getMeaningAiMessage(aiCheck) { if (isMeaningAiFailed(aiCheck)) return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân'); if (isMeaningAiEnabled() && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI'; return 'Đúng ý nghĩa AI'; }
  function buildFilterData(matchedKeyword, aiCheck) { const keywordEnabled = vars.isFindCommentByKeywords === true && String(vars.commentKeywords || '').trim().length > 0; const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : ''); const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : ''); return { keywordEnabled, keyword: keywordEnabled ? String(vars.commentKeywords || '') : null, matchedKeyword: keywordEnabled ? matchedKeyword : null, aiPrompt: String(vars.commentContentAI || '') || null, aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''), aiRawResult: rawResult, aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''), aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null, aiReason: reason || null, aiResult: rawResult || null }; }
  function normalizePhone(value) { const raw = String(value || '').trim(); const compact = raw.replace(/[\s.\-]/g, ''); let digits = compact.replace(/[^\d+]/g, ''); if (digits.startsWith('+84')) digits = '0' + digits.slice(3); else if (digits.startsWith('84')) digits = '0' + digits.slice(2); digits = digits.replace(/\D/g, ''); if (/^0[35789]\d{8}$/.test(digits)) return digits; return ''; }
  function findPhones(text) { const matches = String(text || '').match(/(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}\b/g) || []; return matches.map(normalizePhone).filter(Boolean); }
  function findZaloLinks(text) { const matches = String(text || '').match(/(?:https?:\/\/)?zalo\.me\/g\/[a-z0-9]+/gi) || []; return matches.map(x => x.trim()).filter(Boolean); }
  function unique(arr) { return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean))); }
  function authorUidFromItem(item) { const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim(); const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim(); try { const url = new URL(rawHref, 'https://www.facebook.com'); const parts = url.pathname.split('/').map(part => { try { return decodeURIComponent(part); } catch { return part; } }).map(part => part.trim()).filter(Boolean); const lowerParts = parts.map(part => part.toLowerCase()); const firstPathPart = lowerParts[0] || ''; if (firstPathPart === 'profile.php') { const id = url.searchParams.get('id'); return id ? id.trim() : ''; } const userIndex = lowerParts.indexOf('user'); if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1]; if (firstPathPart === 'groups') return ''; const blockedPathParts = new Set(['posts', 'permalink', 'permalink.php', 'story.php', 'photo.php', 'photos', 'watch', 'reel', 'videos', 'video.php']); if (lowerParts.some(part => blockedPathParts.has(part))) return ''; if (parts.length === 1 && parts[0]) return parts[0]; } catch {} return fallbackUid; }

  const results = ensureResults();
  const sourceComment = results.sourceData.comment;
  const commentSourcePosts = Array.isArray(vars.findDataSearchPosts) ? vars.findDataSearchPosts : [];
  const commentsByPost = new Map();
  for (const comment of vars.findDataSearchComments) { const postIndex = Math.max(1, Number(comment && comment.postIndex ? comment.postIndex : 0)); if (!commentsByPost.has(postIndex)) commentsByPost.set(postIndex, []); commentsByPost.get(postIndex).push(comment); }
  const commentLogEvents = [];
  let matchedComments = 0;
  let globalCommentIndex = 0;

  for (const rawStat of commentPostStats) {
    const stat = rawStat && typeof rawStat === 'object' ? rawStat : {};
    const postIndex = Math.max(1, Number(stat.postIndex || 0));
    const commentsCount = Math.max(0, Number(stat.commentsCount || 0));
    const opened = stat.opened === true;
    const sorted = stat.sorted === true;
    const error = String(stat.error || '').trim();
    const sourcePost = commentSourcePosts[postIndex - 1] || {};
    const postUrl = String(sourcePost && sourcePost.postLink ? sourcePost.postLink : '');
    const commentsForPost = commentsByPost.get(postIndex) || [];

    commentLogEvents.push({ eventType: 'open_comments', eventName: 'Mở comment', targetType: 'comment', status: opened ? 'success' : 'skipped', isUserVisible: false, xpath: selectors.commentButton, itemIndex: postIndex, targetUrl: postUrl, message: opened ? 'Đã mở comment của bài post #' + postIndex : 'Bỏ qua mở comment của bài post #' + postIndex, debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error, searchKeyword: vars.findDataSearchKeyword || '' } });
    if (sortType !== 'most_relevant' && opened) commentLogEvents.push({ eventType: 'sort_comments', eventName: 'Sắp xếp comment', targetType: 'comment', status: sorted ? 'success' : 'failed', isUserVisible: false, itemIndex: postIndex, targetUrl: postUrl, message: sorted ? 'Đã đổi sắp xếp comment của bài post #' + postIndex : (error || 'Không sắp xếp được comment của bài post #' + postIndex), debugData: { sortType, postIndex, postUrl, error, selectors: { sortButton: selectors.mostRelevant, allComments: selectors.allComments, newestComments: selectors.newestComments }, searchKeyword: vars.findDataSearchKeyword || '' } });
    commentLogEvents.push({ eventType: 'collect_comments', eventName: 'Lấy danh sách comment', targetType: 'comment', status: opened ? 'success' : 'skipped', isUserVisible: true, xpath: selectors.commentElement, elementCount: commentsCount, itemIndex: postIndex, targetUrl: postUrl, message: 'Bài post #' + postIndex + ': lấy được ' + commentsCount + ' comment', debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error, searchKeyword: vars.findDataSearchKeyword || '' } });

    for (const comment of commentsForPost) {
      globalCommentIndex++;
      const content = String(comment && comment.content ? comment.content : '');
      const contentMatches = matchesContent(content);
      const meaningAiCheck = vars.isFindInComment && contentMatches ? await checkMeaningAi(content, 'comment') : createEmptyMeaningAiCheck();
      const meaningAiAccepted = isMeaningAiAccepted(meaningAiCheck);
      const commentAuthorUidForLog = authorUidFromItem(comment);
      const commentAuthorNameForLog = String(comment && comment.authorName ? comment.authorName : '').trim();
      const commentPhonesForLog = findPhones(content);
      const commentZaloLinksForLog = findZaloLinks(content);
      const commentPostLinksForLog = postUrl ? [postUrl] : [];
      const commentIndexInPost = Math.max(1, Number(comment && comment.commentIndex ? comment.commentIndex : 0));
      const authorUrl = String(comment && comment.authorUrl ? comment.authorUrl : '');

      if (vars.isFindInComment && contentMatches && !meaningAiAccepted) {
        commentLogEvents.push({ eventType: 'extract_comment_data', eventName: 'Lấy thông tin comment', targetType: 'comment', status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped', isUserVisible: true, itemIndex: commentIndexInPost, targetUrl: authorUrl, message: getMeaningAiMessage(meaningAiCheck), extractedData: { entity: { type: 'comment', url: authorUrl, name: commentAuthorNameForLog || null, uid: commentAuthorUidForLog || null, contentText: content }, filters: buildFilterData(true, meaningAiCheck), values: { phones: commentPhonesForLog, zaloGroupLinks: commentZaloLinksForLog, postLinks: commentPostLinksForLog, uids: unique([commentAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, commentIndexInPost, globalCommentIndex, postUrl, authorName: commentAuthorNameForLog, authorUrl, searchKeyword: vars.findDataSearchKeyword || '' } });
        continue;
      }
      if (vars.isFindInComment && contentMatches && meaningAiAccepted) {
        matchedComments++;
        if (vars.isFindPhone) { results.phones.push(...commentPhonesForLog); sourceComment.phones.push(...commentPhonesForLog); for (const phone of commentPhonesForLog) results.phoneProfiles.push({ phone, name: commentAuthorNameForLog, uid: commentAuthorUidForLog, url: authorUrl, source: 'comment' }); }
        if (vars.isFindLinkGroupZalo) { results.linkGroupZalos.push(...commentZaloLinksForLog); sourceComment.linkGroupZalos.push(...commentZaloLinksForLog); }
        if (vars.isFindUid && commentAuthorUidForLog) { results.uids.push(commentAuthorUidForLog); sourceComment.uids.push(commentAuthorUidForLog); results.uidProfiles.push({ uid: commentAuthorUidForLog, name: commentAuthorNameForLog, url: authorUrl, source: 'comment' }); }
        commentLogEvents.push({ eventType: 'extract_comment_data', eventName: 'Lấy thông tin comment', targetType: 'comment', status: 'success', isUserVisible: true, itemIndex: commentIndexInPost, targetUrl: authorUrl, message: 'Đã duyệt comment #' + commentIndexInPost, extractedData: { entity: { type: 'comment', url: authorUrl, name: commentAuthorNameForLog || null, uid: commentAuthorUidForLog || null, contentText: content }, filters: buildFilterData(contentMatches, meaningAiCheck), values: { phones: commentPhonesForLog, zaloGroupLinks: commentZaloLinksForLog, postLinks: commentPostLinksForLog, uids: unique([commentAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, commentIndexInPost, globalCommentIndex, postUrl, authorName: commentAuthorNameForLog, authorUrl, searchKeyword: vars.findDataSearchKeyword || '' } });
      } else if (vars.isFindInComment && !contentMatches) {
        commentLogEvents.push({ eventType: 'extract_comment_data', eventName: 'Lấy thông tin comment', targetType: 'comment', status: 'skipped', isUserVisible: true, itemIndex: commentIndexInPost, targetUrl: authorUrl, message: 'Không chứa keyword', extractedData: { entity: { type: 'comment', url: authorUrl, name: commentAuthorNameForLog || null, uid: commentAuthorUidForLog || null, contentText: content }, filters: buildFilterData(false, createEmptyMeaningAiCheck()), values: { phones: commentPhonesForLog, zaloGroupLinks: commentZaloLinksForLog, postLinks: commentPostLinksForLog, uids: unique([commentAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, commentIndexInPost, globalCommentIndex, postUrl, authorName: commentAuthorNameForLog, authorUrl, searchKeyword: vars.findDataSearchKeyword || '' } });
      }
    }
  }
  if (commentLogEvents.length > 0) commentLogEvents.push({ eventType: 'collect_comments_summary', eventName: 'Tổng kết comment', targetType: 'comment', status: 'success', isUserVisible: true, elementCount: vars.findDataSearchComments.length, message: 'Tổng cộng lấy được ' + vars.findDataSearchComments.length + ' comment từ search', debugData: { postLimit, commentLimit, sortType, matchedComments, searchKeyword: vars.findDataSearchKeyword || '' } });
  await helpers.logRunEvents(commentLogEvents);
  results.phones = unique(results.phones); results.linkGroupZalos = unique(results.linkGroupZalos); results.uids = unique(results.uids); sourceComment.phones = unique(sourceComment.phones); sourceComment.linkGroupZalos = unique(sourceComment.linkGroupZalos); sourceComment.uids = unique(sourceComment.uids);
  vars.findDataSearchMatchedComments = matchedComments;
  return { commentItems: vars.findDataSearchComments, commentPostStats, matchedComments };
$v641$, updated_at = now()
 WHERE id = 2905 AND md5(code) = '79ae67b90927a743a24f146f92245b42';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2554 AND md5(code) = '68fe2e31c508a4657e4de1470eedf01b') THEN RAISE EXCEPTION 'Gỡ V641: block 2554 không về md5 68fe2e31c508a4657e4de1470eedf01b'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2859 AND md5(code) = '68fe2e31c508a4657e4de1470eedf01b') THEN RAISE EXCEPTION 'Gỡ V641: block 2859 không về md5 68fe2e31c508a4657e4de1470eedf01b'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2602 AND md5(code) = '8bba818627fde233ec1b9421c2a7bf7d') THEN RAISE EXCEPTION 'Gỡ V641: block 2602 không về md5 8bba818627fde233ec1b9421c2a7bf7d'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2863 AND md5(code) = '8bba818627fde233ec1b9421c2a7bf7d') THEN RAISE EXCEPTION 'Gỡ V641: block 2863 không về md5 8bba818627fde233ec1b9421c2a7bf7d'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2603 AND md5(code) = 'ffb7329bfa391d3e9a747c4562974cc6') THEN RAISE EXCEPTION 'Gỡ V641: block 2603 không về md5 ffb7329bfa391d3e9a747c4562974cc6'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2864 AND md5(code) = 'ffb7329bfa391d3e9a747c4562974cc6') THEN RAISE EXCEPTION 'Gỡ V641: block 2864 không về md5 ffb7329bfa391d3e9a747c4562974cc6'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2718 AND md5(code) = 'b001a18aa3c3dbb33cf2490386f5b92f') THEN RAISE EXCEPTION 'Gỡ V641: block 2718 không về md5 b001a18aa3c3dbb33cf2490386f5b92f'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2904 AND md5(code) = 'b001a18aa3c3dbb33cf2490386f5b92f') THEN RAISE EXCEPTION 'Gỡ V641: block 2904 không về md5 b001a18aa3c3dbb33cf2490386f5b92f'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2719 AND md5(code) = '6acf4fe3889a851e176aee9ceba9f5a4') THEN RAISE EXCEPTION 'Gỡ V641: block 2719 không về md5 6acf4fe3889a851e176aee9ceba9f5a4'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2905 AND md5(code) = '6acf4fe3889a851e176aee9ceba9f5a4') THEN RAISE EXCEPTION 'Gỡ V641: block 2905 không về md5 6acf4fe3889a851e176aee9ceba9f5a4'; END IF;
END $post$;

COMMIT;
