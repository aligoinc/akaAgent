-- Promote the tested comment-seeding post-search implementation to the shared
-- built-in block, then remove per-node overrides from both production and test.
--
-- The live database temporarily contained this implementation only in the test
-- workflow's prepare-node override while the shared block had stale code. Keep
-- the promoted implementation embedded here so a clean database reaches the
-- exact same production/test state without depending on live workflow data.

BEGIN;

DO $migration$
DECLARE
  v_workflow_id bigint;
  v_test_workflow_id bigint;
  v_shared_block_id bigint;
  v_canonical_code text := $canonical$
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
$canonical$;
  v_target_workflow_count integer;
  v_prepare_node_workflow_count integer;
  v_updated_workflow_count integer;
  v_remaining_override_count integer;
BEGIN
  SELECT action.workflow_id, action.test_workflow_id
  INTO v_workflow_id, v_test_workflow_id
  FROM public.auto_campaign_actions action
  WHERE action.id = 'facebook_comment_seeding';

  IF v_workflow_id IS NULL OR v_test_workflow_id IS NULL THEN
    RAISE EXCEPTION
      'facebook_comment_seeding must have both production and test workflows';
  END IF;

  SELECT block.id
  INTO v_shared_block_id
  FROM public.auto_blocks block
  WHERE block.name = 'fb_prepare_seeding_iterations';

  IF v_shared_block_id IS NULL THEN
    RAISE EXCEPTION
      'Missing shared block fb_prepare_seeding_iterations';
  END IF;

  IF v_canonical_code IS NULL
    OR position('postKeywords' IN v_canonical_code) = 0
    OR position('postContentAI' IN v_canonical_code) = 0
    OR position('logRunEvent' IN v_canonical_code) = 0
    OR position('comment_seeding_post_search_summary' IN v_canonical_code) = 0
  THEN
    RAISE EXCEPTION
      'Refusing to promote fb_prepare_seeding_iterations: canonical code is missing keyword, AI, or run-event behavior';
  END IF;

  WITH target_workflows AS (
    SELECT DISTINCT workflow_id
    FROM (
      VALUES (v_workflow_id), (v_test_workflow_id)
    ) AS ids(workflow_id)
    WHERE workflow_id IS NOT NULL
  )
  SELECT count(*)
  INTO v_target_workflow_count
  FROM target_workflows;

  WITH target_workflows AS (
    SELECT DISTINCT workflow_id
    FROM (
      VALUES (v_workflow_id), (v_test_workflow_id)
    ) AS ids(workflow_id)
    WHERE workflow_id IS NOT NULL
  )
  SELECT count(DISTINCT workflow.id)
  INTO v_prepare_node_workflow_count
  FROM public.auto_workflows workflow
  JOIN target_workflows target ON target.workflow_id = workflow.id
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(workflow.nodes, '[]'::jsonb)
  ) AS node(value)
  WHERE (
    node.value->>'blockName' = 'fb_prepare_seeding_iterations'
    OR node.value#>>'{data,blockName}' = 'fb_prepare_seeding_iterations'
  )
    AND COALESCE(
      NULLIF(node.value->>'blockId', '')::bigint,
      NULLIF(node.value#>>'{data,blockId}', '')::bigint
    ) = v_shared_block_id;

  IF v_target_workflow_count <> 2
    OR v_prepare_node_workflow_count <> v_target_workflow_count
  THEN
    RAISE EXCEPTION
      'Expected production and test workflows to reference shared prepare block %, found %/%',
      v_shared_block_id,
      v_prepare_node_workflow_count,
      v_target_workflow_count;
  END IF;

  UPDATE public.auto_blocks
  SET
    code = v_canonical_code,
    updated_at = now()
  WHERE id = v_shared_block_id;

  WITH target_workflows AS (
    SELECT DISTINCT workflow_id
    FROM (
      VALUES (v_workflow_id), (v_test_workflow_id)
    ) AS ids(workflow_id)
    WHERE workflow_id IS NOT NULL
  )
  UPDATE public.auto_workflows workflow
  SET
    nodes = (
      SELECT COALESCE(
        jsonb_agg(
          CASE
            WHEN (
              node.value->>'blockName' = 'fb_prepare_seeding_iterations'
              OR node.value#>>'{data,blockName}' = 'fb_prepare_seeding_iterations'
            )
            THEN
              CASE
                WHEN jsonb_typeof(node.value->'data') = 'object'
                THEN jsonb_set(
                  node.value - 'codeOverride',
                  '{data}',
                  (node.value->'data') - 'codeOverride',
                  false
                )
                ELSE node.value - 'codeOverride'
              END
            ELSE node.value
          END
          ORDER BY node.ordinality
        ),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(
        COALESCE(workflow.nodes, '[]'::jsonb)
      ) WITH ORDINALITY AS node(value, ordinality)
    ),
    updated_at = now()
  FROM target_workflows target
  WHERE workflow.id = target.workflow_id;

  GET DIAGNOSTICS v_updated_workflow_count = ROW_COUNT;

  IF v_updated_workflow_count <> v_target_workflow_count THEN
    RAISE EXCEPTION
      'Expected to update % comment-seeding workflows, updated %',
      v_target_workflow_count,
      v_updated_workflow_count;
  END IF;

  WITH target_workflows AS (
    SELECT DISTINCT workflow_id
    FROM (
      VALUES (v_workflow_id), (v_test_workflow_id)
    ) AS ids(workflow_id)
    WHERE workflow_id IS NOT NULL
  )
  SELECT count(*)
  INTO v_remaining_override_count
  FROM public.auto_workflows workflow
  JOIN target_workflows target ON target.workflow_id = workflow.id
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(workflow.nodes, '[]'::jsonb)
  ) AS node(value)
  WHERE (
    node.value->>'blockName' = 'fb_prepare_seeding_iterations'
    OR node.value#>>'{data,blockName}' = 'fb_prepare_seeding_iterations'
  )
    AND (
      NULLIF(node.value->>'codeOverride', '') IS NOT NULL
      OR NULLIF(node.value#>>'{data,codeOverride}', '') IS NOT NULL
    );

  IF v_remaining_override_count <> 0 THEN
    RAISE EXCEPTION
      'Failed to remove all fb_prepare_seeding_iterations code overrides';
  END IF;
END;
$migration$;

COMMIT;
