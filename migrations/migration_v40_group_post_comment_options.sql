-- Add group-post comment filters by post approval state and target post mode.

BEGIN;

UPDATE public.auto_blocks
SET
  description = 'Điều chỉnh danh sách comment group post theo trạng thái duyệt bài và tuỳ chọn post cần comment',
  code = $block$
const originalIterations = Array.isArray(vars.commentIterations) ? vars.commentIterations : [];
const enableComment = vars.enableComment === true;
const isPending = vars.groupPostIsPending === true;
const rawCommentType = String(vars.commentType || 'own');
const commentType = ['own', 'others', 'all'].includes(rawCommentType) ? rawCommentType : 'own';
const rawGroupMode = String(vars.commentGroupMode || 'all');
const commentGroupMode = ['all', 'pending_only', 'published_only'].includes(rawGroupMode) ? rawGroupMode : 'all';

let commentIterations = originalIterations;
let adjusted = false;
let skippedOwnPending = false;
let skippedByGroupMode = false;
let skipReason = '';

if (enableComment) {
  if (commentGroupMode === 'pending_only' && !isPending) {
    commentIterations = [];
    adjusted = true;
    skippedByGroupMode = true;
    skipReason = 'Bỏ qua comment vì chỉ chọn comment group bị duyệt đăng bài';
    helpers.log(skipReason);
  } else if (commentGroupMode === 'published_only' && isPending) {
    commentIterations = [];
    adjusted = true;
    skippedByGroupMode = true;
    skipReason = 'Bỏ qua comment vì chỉ chọn comment group đăng bài thành công ngay';
    helpers.log(skipReason);
  } else if (isPending && commentType === 'own') {
    commentIterations = [];
    adjusted = true;
    skippedOwnPending = true;
    helpers.log('Bài đang chờ duyệt nên bỏ qua comment vào bài của mình');
  } else if (isPending && commentType === 'others') {
    commentIterations = originalIterations.map((item, index) => {
      const row = item && typeof item === 'object' ? item : {};
      const currentPosition = Number(row.position || index + 2);
      return {
        ...row,
        position: Math.max(1, currentPosition - 1)
      };
    });
    adjusted = true;
    helpers.log('Bài đang chờ duyệt nên comment bài khác bắt đầu từ bài đầu tiên');
  }
}

vars.commentIterations = commentIterations;

return {
  adjusted,
  skippedOwnPending,
  skippedByGroupMode,
  skipReason,
  commentGroupMode,
  commentType,
  isPending,
  commentIterations
};
$block$,
  output_schema = '[
    {"name":"adjusted","type":"boolean","label":"Đã điều chỉnh"},
    {"name":"skippedOwnPending","type":"boolean","label":"Bỏ qua comment bài mình"},
    {"name":"skippedByGroupMode","type":"boolean","label":"Bỏ qua theo tuỳ chọn group"},
    {"name":"skipReason","type":"string","label":"Lý do bỏ qua"},
    {"name":"commentGroupMode","type":"string","label":"Kiểu group được comment"},
    {"name":"commentType","type":"string","label":"Kiểu post được comment"},
    {"name":"isPending","type":"boolean","label":"Bài pending"},
    {"name":"commentIterations","type":"json","label":"Danh sách comment"}
  ]'::jsonb,
  updated_at = now()
WHERE name = 'fb_adjust_group_post_comments_after_pending';

COMMIT;
