-- Use existing enablePostLike/enableComment flags as the action toggles for newsfeed interaction.

BEGIN;

UPDATE public.auto_blocks
SET code = $block$
const timeMinutes = Math.max(1, Math.floor(Number(vars.newsfeedTimeMinutes || input.newsfeedTimeMinutes || 20)))
const likeEnabled = vars.enablePostLike === true || input.enablePostLike === true
const commentEnabled = vars.enableComment === true || input.enableComment === true
const likeKind = String(vars.newsfeedLikeKind || input.newsfeedLikeKind || '').trim()
const commentKind = String(vars.newsfeedCommentKind || input.newsfeedCommentKind || '').trim()
const likeLimit = likeEnabled ? Math.max(0, Math.floor(Number(vars.newsfeedLikeLimit ?? input.newsfeedLikeLimit ?? 10))) : 0
const commentLimit = commentEnabled ? Math.max(0, Math.floor(Number(vars.newsfeedCommentLimit ?? input.newsfeedCommentLimit ?? 10))) : 0
const allowLike = vars.allowNewsfeedLike !== false
const allowComment = vars.allowNewsfeedComment !== false
const remainingLike = allowLike ? likeLimit : 0
const remainingComment = allowComment ? commentLimit : 0

vars.newsfeedState = {
  startedAt: Date.now(),
  maxMs: timeMinutes * 60000,
  cursor: 0,
  lastCount: 0,
  stepDelayMs: 1000,
  loadPostDelayMs: 5000,
  actionGapSeconds: 4,
  tcRead: 3,
  timeRead100WordsMin: 20,
  tcWrite: 3,
  timeWrite100WordsMin: 90,
  likeEnabled,
  commentEnabled,
  likeKind,
  commentKind,
  commentContent: String(vars.newsfeedCommentContent || input.newsfeedCommentContent || ''),
  commentUseAI: vars.newsfeedCommentUseAI === true || input.newsfeedCommentUseAI === true,
  remainingLike,
  remainingComment,
  likeDone: 0,
  commentDone: 0,
  shouldContinue: remainingLike > 0 || remainingComment > 0,
  currentPost: null
}
helpers.log('Bắt đầu lướt newsfeed trong ' + timeMinutes + ' phút')
return {
  ok: true,
  shouldContinue: vars.newsfeedState.shouldContinue,
  remainingLike,
  remainingComment
}
$block$,
updated_at = now()
WHERE name = 'fb_newsfeed_init_state';

UPDATE public.auto_workflows
SET variables_schema = '[
    {"name":"newsfeedTimeMinutes","type":"number","label":"Thời gian lướt"},
    {"name":"enablePostLike","type":"boolean","label":"Thực hiện like"},
    {"name":"newsfeedLikeKind","type":"string","label":"Like nội dung có tính chất"},
    {"name":"newsfeedLikeLimit","type":"number","label":"Like tối đa"},
    {"name":"enableComment","type":"boolean","label":"Thực hiện comment"},
    {"name":"newsfeedCommentKind","type":"string","label":"Comment bài post có tính chất"},
    {"name":"newsfeedCommentLimit","type":"number","label":"Comment tối đa"},
    {"name":"newsfeedCommentContent","type":"string","label":"Nội dung comment"},
    {"name":"newsfeedCommentUseAI","type":"boolean","label":"AI tạo comment"},
    {"name":"allowNewsfeedLike","type":"boolean","label":"Cho phép like"},
    {"name":"allowNewsfeedComment","type":"boolean","label":"Cho phép comment"}
  ]'::jsonb,
  default_variables = '{"newsfeedTimeMinutes":20,"enablePostLike":false,"newsfeedLikeKind":"","newsfeedLikeLimit":10,"enableComment":false,"newsfeedCommentKind":"","newsfeedCommentLimit":10,"newsfeedCommentContent":"","newsfeedCommentUseAI":false,"allowNewsfeedLike":true,"allowNewsfeedComment":true}'::jsonb,
  updated_at = now()
WHERE name = 'facebook_newsfeed_interaction';

COMMIT;
