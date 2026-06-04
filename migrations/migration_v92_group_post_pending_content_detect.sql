-- Detect group post approval through visible secondary preview of my_pending_content.

BEGIN;

UPDATE public.auto_blocks
SET
  code = $block$
if (vars.groupPostSkippedByKnownApproval === true || vars.skipGroupPostByKnownApproval === true) {
  const isPending = vars.groupPostRequiresPostApproval === true;
  vars.groupPostIsPending = isPending;
  return {
    isPending,
    postUrl: '',
    skippedPost: true,
    source: vars.groupPostApprovalSource || 'account_contact',
    pendingCheckConclusive: true
  };
}

const groupPostUrl = String(vars.groupPostPostUrl || input.postUrl || input.link || '').trim();
if (groupPostUrl.includes('/pending_posts/')) {
  vars.groupPostIsPending = true;
  return {
    isPending: true,
    postUrl: groupPostUrl,
    pendingCheckConclusive: true,
    source: 'post_url'
  };
}

function extractGroupKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const cleaned = raw.replace(/^\/+|\/+$/g, '');
  if (/^groups\//i.test(cleaned)) {
    const parts = cleaned.split('/').filter(Boolean);
    return parts[1] || '';
  }

  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
    const parts = url.pathname.split('/').filter(Boolean);
    const groupIdx = parts.findIndex(part => part.toLowerCase() === 'groups');
    if (groupIdx >= 0 && parts[groupIdx + 1]) return parts[groupIdx + 1];
  } catch {}

  if (/^[a-zA-Z0-9._-]+$/.test(cleaned)) return cleaned;
  return '';
}

function buildPendingContentUrl() {
  const sources = [
    vars.targetUrl,
    vars.inputDataUid,
    input.targetUrl,
    groupPostUrl,
    vars.groupPostRawPostLink,
    input.rawPostLink
  ];

  for (const source of sources) {
    const groupKey = extractGroupKey(source);
    if (groupKey) {
      return 'https://www.facebook.com/groups/' + encodeURIComponent(groupKey) + '/my_pending_content';
    }
  }
  return '';
}

const pendingContentUrl = buildPendingContentUrl();
if (!pendingContentUrl) {
  vars.groupPostIsPending = false;
  helpers.log('Không dựng được URL my_pending_content để kiểm tra bài chờ duyệt');
  return {
    isPending: false,
    postUrl: groupPostUrl,
    pendingContentUrl: '',
    pendingContentLinks: [],
    pendingCheckConclusive: false,
    source: 'missing_pending_content_url'
  };
}

const rawSelector = await helpers.element('GroupPostRawPostLink');
const linkSelector = await helpers.element('GroupPostPostLink');

helpers.log('Đang kiểm tra trang bài chờ duyệt: ' + pendingContentUrl);

let check;
try {
  check = await helpers.checkGroupPendingContent({
    url: pendingContentUrl,
    rawSelector,
    linkSelector,
    timeoutMs: 18000
  });
} catch (err) {
  const message = err && err.message ? String(err.message) : String(err);
  vars.groupPostIsPending = false;
  helpers.log('Không kiểm tra được trang bài chờ duyệt: ' + message);
  return {
    isPending: false,
    postUrl: groupPostUrl,
    pendingContentUrl,
    pendingContentLinks: [],
    pendingCheckConclusive: false,
    source: 'pending_content_error',
    error: message
  };
}

const links = Array.isArray(check && check.links)
  ? check.links.map(link => String(link || '').trim()).filter(Boolean)
  : [];
const conclusive = check && check.conclusive === true;

if (!conclusive) {
  const message = check && check.error ? String(check.error) : 'không kết luận được';
  vars.groupPostIsPending = false;
  helpers.log('Không kết luận được trạng thái chờ duyệt từ my_pending_content: ' + message);
  return {
    isPending: false,
    postUrl: groupPostUrl,
    pendingContentUrl,
    pendingContentLinks: links,
    pendingCheckConclusive: false,
    source: 'pending_content_inconclusive',
    error: message
  };
}

const isPending = links.length > 0;
vars.groupPostIsPending = isPending;

helpers.log(isPending
  ? 'Phát hiện bài trong trang chờ duyệt của group'
  : 'Không thấy bài trong trang chờ duyệt của group');

return {
  isPending,
  postUrl: groupPostUrl,
  pendingContentUrl,
  pendingContentLinks: links,
  pendingCheckConclusive: true,
  source: isPending ? 'pending_content' : 'pending_content_empty'
};
$block$,
  output_schema = '[
    {"name":"isPending","type":"boolean","label":"Bài có đang chờ duyệt không"},
    {"name":"postUrl","type":"string","label":"Post URL"},
    {"name":"skippedPost","type":"boolean","label":"Đã bỏ qua đăng bài"},
    {"name":"source","type":"string","label":"Nguồn trạng thái"},
    {"name":"pendingContentUrl","type":"string","label":"URL trang bài chờ duyệt"},
    {"name":"pendingContentLinks","type":"json","label":"Link tìm thấy trong trang bài chờ duyệt"},
    {"name":"pendingCheckConclusive","type":"boolean","label":"Đã kết luận được từ trang pending"},
    {"name":"error","type":"string","label":"Lỗi kiểm tra pending"}
  ]'::jsonb,
  updated_at = now()
WHERE name = 'fb_detect_pending_post';

COMMIT;
