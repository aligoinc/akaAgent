#!/usr/bin/env node
// V563: engine v2 Facebook, sửa riêng phần engine sau khi rà lỗi Facebook 30 ngày (17/11/2026, docs/ENGINE_V2_FACEBOOK_ERROR_REVIEW_20261117.md).
// Bộ cũ không đổi gì: bộ cũ không nạp block "[engine] …" (chọn workflow qua auto_campaign_actions.workflow_id) và không đọc dòng
// facebook.error_signs (chỉ src/main/engineAdapters/facebook/errorSigns.ts đọc). Anh chốt 17/11: "engine cũ đừng đụng vào".
//
//   1. Bản "[engine] fb_collect_search_groups" (tìm nhóm bằng search). Facebook giao diện tiếng Anh ghi "90+ posts a day" / "1 post a day",
//      block chỉ đọc "bài viết/ngày" / "posts/day" nên số bài/ngày luôn 0: có cài "Số bài tối thiểu/ngày" thì mọi nhóm bị loại (30 ngày:
//      8.865 thẻ / 13 chiến dịch; 09/11 một khách bị loại cả 4.540 nhóm, khớp tin khách báo "kết quả trả về đều = 0"). Tên nhóm lấy từ link
//      ảnh đại diện dính "Profile photo of " (10.950 tên trong 30 ngày). Đọc như src/shared/facebookSearchGroupCard.ts (#630 mới sửa phần
//      hiển thị ở tab Data, block vẫn lọc / lưu sai).
//   2. Bản "[engine] fb_comment_at_position" (đăng nhóm kèm comment). Bộ cũ comment vào ô bình luận thứ N trên trang, không xem ô đó thuộc bài
//      nào: không lấy được link bài vừa đăng (bài video chưa hiện, chờ duyệt mà không nhận ra…) thì "comment bài của mình" vẫn comment vào bài
//      người khác (7 ngày tới 17/11: 307 lượt ở bài có video, 38 lượt bài không video; có link mà vẫn nhầm bài 17 lượt; "comment tất cả" comment
//      lại chính bài mình ở lượt dành cho bài khác 18 lượt; khách báo 03/11, 05/11). Bản engine: "bài của mình" chỉ comment khi ô bình luận nằm
//      trong khung bài có mã bài trùng link vừa lấy, không thấy thì bỏ qua như bài chờ duyệt (không ghi dòng lịch sử, không tính lượt); comment
//      bài khác mà ô ở vị trí đó thuộc bài vừa đăng thì lấy ô của bài kế tiếp. Chỉ trong workflow đăng nhóm (vars.groupPostSubmitted); comment
//      seeding (cùng block) giữ y bộ cũ. Danh mục bước của block (mức 2, gửi bằng Enter) ghi md5 bản đã duyệt mới.
//   2b. Bản "[engine] fb_adjust_group_post_comments_after_pending" (chạy sau bước lấy link, trước vòng comment). Anh chốt 17/11 ("Câu ⚠️, chỉ
//      sửa DB"): đăng nhóm xong mà chưa lấy được link bài vừa đăng thì bỏ lượt comment "bài của mình" (comment bài của mình, hoặc vị trí 1 của
//      "comment tất cả" khi bài không chờ duyệt) và báo khách một câu tiến trình: bộ dựng lịch sử của bộ cũ đã in "⚠️ <lý do> tại "<nhóm>""
//      khi block này trả skippedByGroupMode (chỗ đang in "Bỏ qua comment vì chỉ chọn comment group …"); không ghi dòng lịch sử, không tính
//      lượt. Comment bài khác vẫn chạy. Link có mà không thấy bài trên trang thì block comment (mục 2) bỏ qua, không có câu.
//   3. Dấu hiệu FB11 (anh chốt 17/11: chỉ phát mã cụ thể khi thấy dấu hiệu có mặt): đăng nhóm không thấy ô đăng bài (FB40) mà trang có nút
//      "Tham gia nhóm" / "Join group" = tài khoản chưa vào nhóm (xem trang thật 17/11 bằng tài khoản thử của anh: nhóm chưa tham gia không có ô
//      đăng bài, có nút "Tham gia nhóm"; nhóm đã tham gia có ô "Bạn viết gì đi...", không có nút đó). Chính sách FB11 khi đăng nhóm = bản chép
//      chính sách FB40 (ghi "bỏ qua", không tính lượt, không cộng chuỗi, data hoàn thành), chỉ đổi câu cho khách thành câu anh đã duyệt 17/11
//      ("Tài khoản chưa vào nhóm này nên chưa đăng bài được"), như FB14 ở V559. Dòng FB11 chung của V559 giữ nguyên (FB11 chưa có chỗ phát khác).
//
// Nguồn guard: scripts/fixtures/engine-v2-facebook/v563-live-20261117.json (đọc chỉ đọc production 17/11). Preflight từ chối khi code block,
// danh mục bước, dòng dấu hiệu hay dòng chính sách FB40 khác bản đã đọc. Chạy: node scripts/build-v563-sql.cjs (ghi migration + bản gỡ).
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const LIVE_FILE = path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/v563-live-20261117.json')
const LIVE = JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'))
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const SIGNS_KEY = 'facebook.error_signs'
const FB11 = 'err_fb_group_cannot_post_not_member'
const FB40 = 'err_fb_group_composer_editor_not_found'
const FB11_TITLE = 'Tài khoản chưa vào nhóm này nên chưa đăng bài được'
const SOURCE = 'v563_fb_signs'
/** Câu tiến trình khi bỏ qua comment "bài của mình" (anh duyệt 17/11, bản "Câu ⚠️, chỉ sửa DB"). */
const OWN_POST_SKIP_MESSAGE = 'Chưa thấy bài vừa đăng trên trang nhóm nên bỏ qua comment vào bài của mình'

// ------------------------------------------------------------------------------------------------ code mới của từng block
/** Chèn vào bản "[engine] fb_adjust_group_post_comments_after_pending", ngay trước khi ghi vars.commentIterations (mã bài đọc như block comment). */
const ADJUST_INSERT = String.raw`// [engine] V563 (anh chốt 17/11): đăng nhóm xong mà chưa lấy được link bài vừa đăng (bài video chưa hiện, Facebook chưa hiện bài…) thì bỏ
// lượt comment "bài của mình" thay vì comment vào ô đầu tiên trên trang (thường là bài người khác), và báo khách một câu tiến trình (bộ dựng
// lịch sử in câu ⚠️ khi skippedByGroupMode; không ghi dòng lịch sử, không tính lượt). Comment bài khác vẫn chạy.
if (enableComment && !skippedByGroupMode && vars.groupPostSubmitted === true && commentIterations.length > 0) {
  const ownPostWanted = commentType === 'own' || (commentType === 'all' && !isPending);
  const ownPostUrl = String(vars.groupPostPostUrl || '');
  const ownPostMatch = ownPostUrl.match(/\/(?:posts|permalink)\/(\d+)/) || ownPostUrl.match(/[?&]story_fbid=(\d+)/);
  if (ownPostWanted && !ownPostMatch) {
    commentIterations = commentIterations.filter((item, index) => {
      const row = item && typeof item === 'object' ? item : {};
      return Number(row.position || index + 1) !== 1;
    });
    adjusted = true;
    skippedByGroupMode = true;
    skipReason = '${OWN_POST_SKIP_MESSAGE}';
    helpers.log(skipReason);
  }
}
`
const COMMENT_HELPERS = String.raw`// [engine] V563 (rà lỗi Facebook 17/11/2026): đăng nhóm kèm comment chỉ comment "bài của mình" khi thấy đúng bài vừa đăng: mã bài trong
// link lấy sau khi đăng (vars.groupPostPostUrl) trùng mã bài trong khung chứa ô bình luận. Không thấy (chưa lấy được link, bài video chưa
// hiện, bài chờ duyệt) thì bỏ qua, không comment vào bài người khác (chưa lấy được link thì block chỉnh comment đã bỏ lượt này và báo khách
// trước vòng comment). Comment bài khác mà ô ở đúng vị trí lại thuộc bài vừa
// đăng thì lấy ô của bài kế tiếp. Chỉ trong workflow đăng nhóm (vars.groupPostSubmitted); comment seeding giữ như bộ cũ.
const __OWN_POST_SKIP_MESSAGE = '${OWN_POST_SKIP_MESSAGE}'
function __commentPostIdOf(url) {
  const text = String(url || '')
  const match = text.match(/\/(?:posts|permalink)\/(\d+)/) || text.match(/[?&]story_fbid=(\d+)/)
  return match ? match[1] : ''
}
async function __resolveCommentTarget(position) {
  if (vars.groupPostSubmitted !== true) return { xpath: null }
  const kind = String(vars.commentType || 'own')
  const ownTarget = position === 1 && (kind === 'own' || (kind === 'all' && vars.groupPostIsPending !== true))
  const ownId = __commentPostIdOf(vars.groupPostPostUrl)
  if (!ownTarget && !ownId) return { xpath: null }
  if (ownTarget && !ownId) return { skip: true, message: __OWN_POST_SKIP_MESSAGE }
  const indexed = String(await helpers.elementWith('fb_comment_box_at_n', { n: 1 }))
  if (!/\[1\]\s*$/.test(indexed)) return ownTarget ? { skip: true, message: __OWN_POST_SKIP_MESSAGE } : { xpath: null }
  const union = indexed.replace(/\[1\]\s*$/, '')
  const token = 'aka_cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2)
  const picked = await page.evaluate(String.raw${'`'}
    const unionXpath = __args[0]; const ownId = __args[1]; const token = __args[2]; const mode = __args[3]; const position = Number(__args[4]) || 1;
    function xpathAll(xpath) { const out = []; try { const r = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); for (let i = 0; i < r.snapshotLength; i++) { const it = r.snapshotItem(i); if (it) out.push(it); } } catch {} return out; }
    function idOfHref(href) { if (!href) return ''; let text = String(href); try { text = new URL(text, location.href).href; } catch {} const m = text.match(/\/(?:posts|permalink)\/(\d+)/) || text.match(/[?&]story_fbid=(\d+)/); return m ? m[1] : ''; }
    function postIdOf(el) { let node = el; let found = ''; for (let depth = 0; node && node.nodeType === 1 && depth < 40; depth++) { const ids = new Set(); const anchors = node.querySelectorAll('a[href]'); for (let i = 0; i < anchors.length; i++) { const id = idOfHref(anchors[i].getAttribute('href')); if (id) { ids.add(id); if (ids.size > 1) break; } } if (ids.size > 1) break; if (ids.size === 1) found = Array.from(ids)[0]; node = node.parentElement; } return found; }
    for (const el of Array.from(document.querySelectorAll('[data-aka-comment-target]'))) el.removeAttribute('data-aka-comment-target');
    const boxes = xpathAll(unionXpath);
    let chosen = null;
    if (mode === 'own') {
      chosen = boxes.find(el => postIdOf(el) === ownId) || null;
    } else {
      const atPosition = boxes[position - 1];
      if (!atPosition || postIdOf(atPosition) !== ownId) return 'legacy';
      for (let i = position; i < boxes.length; i++) { if (postIdOf(boxes[i]) !== ownId) { chosen = boxes[i]; break; } }
    }
    if (!chosen) return 'none';
    chosen.setAttribute('data-aka-comment-target', token);
    return 'marked';
  ${'`'}, union, ownId, token, ownTarget ? 'own' : 'other', position)
  if (picked === 'marked') return { xpath: "//*[@data-aka-comment-target='" + token + "']" }
  if (ownTarget) return { skip: true, message: __OWN_POST_SKIP_MESSAGE }
  return { xpath: null }
}

`

const BLOCKS = [
  {
    key: 'search',
    live: LIVE.block,
    edits: [
      {
        why: 'giao diện tiếng Anh ghi "90+ posts a day" / "1 post a day" (cùng mẫu với src/shared/facebookSearchGroupCard.ts POSTS_PER_DAY)',
        from: String.raw`text.match(/([\d.,]+)\+?\s*posts\/day/i);`,
        to: String.raw`text.match(/([\d.,]+)\+?\s*posts\/day/i) || text.match(/([\d.,]+)\+?\s*posts?\s+(?:a|per)\s+day/i);`
      },
      {
        why: 'tên nhóm lấy từ link ảnh đại diện dính "Profile photo of " (cùng mẫu với AVATAR_PREFIX của facebookSearchGroupCard.ts)',
        from: String.raw`.replace(/^Ảnh đại diện của\s+/i, '')`,
        to: String.raw`.replace(/^(?:Profile photo of|Ảnh đại diện của)\s+/i, '')`
      }
    ]
  },
  {
    key: 'comment',
    live: LIVE.commentBlock,
    edits: [
      {
        why: 'chọn ô bình luận: "bài của mình" theo mã bài vừa đăng; không thấy thì bỏ qua trước khi soạn nội dung (không lấy lượt nội dung / gọi AI)',
        from: 'const pos = Number(input.position || item.position || 1)\n',
        to: 'const pos = Number(input.position || item.position || 1)\n'
          + 'const __commentTarget = await __resolveCommentTarget(pos)\n'
          + 'if (__commentTarget.skip) {\n'
          + '  helpers.log(__commentTarget.message)\n'
          + '  return { commented: false, position: pos, text: \'\', imageCount: 0, ownPostSkipped: true, skipReason: __commentTarget.message }\n'
          + '}\n'
      },
      {
        why: 'bấm đúng ô đã chọn (bộ cũ: ô thứ N trên trang)',
        from: "  const boxXpath = await helpers.elementWith('fb_comment_box_at_n', { n: pos })\n",
        to: "  const boxXpath = __commentTarget.xpath || await helpers.elementWith('fb_comment_box_at_n', { n: pos })\n"
      }
    ],
    prepend: COMMENT_HELPERS
  },
  {
    key: 'adjust',
    live: LIVE.adjustBlock,
    edits: [
      {
        why: 'chưa lấy được link bài vừa đăng thì bỏ lượt comment "bài của mình" và báo khách (câu ⚠️ của bộ dựng lịch sử khi skippedByGroupMode)',
        from: '\nvars.commentIterations = commentIterations;\n',
        to: '\n' + ADJUST_INSERT + '\nvars.commentIterations = commentIterations;\n'
      }
    ]
  }
]

for (const block of BLOCKS) {
  const live = block.live
  if (!live || !live.code || md5(live.code) !== live.md5) throw new Error(`Fixture: block ${block.key} thiếu code hoặc md5 không khớp`)
  if (!live.name.startsWith('[engine] ')) throw new Error(`Fixture: block ${live.name} không phải bản engine`)
  let code = live.code
  for (const edit of block.edits) {
    const count = code.split(edit.from).length - 1
    if (count !== 1) throw new Error(`Block ${live.name}, sửa "${edit.why}": tìm thấy ${count} chỗ, cần đúng 1`)
    code = code.replace(edit.from, () => edit.to)
  }
  if (block.prepend) code = block.prepend + code
  block.newCode = code
  block.oldMd5 = live.md5
  block.newMd5 = md5(code)
  block.steps = Array.isArray(live.steps) ? live.steps : []
  block.stepRows = block.steps.length || live.stepRows || 0
  block.tag = `$v563_${block.key}$`
  if (live.code.includes(block.tag) || code.includes(block.tag)) throw new Error(`Code block ${live.name} chứa thẻ dollar-quote`)
  for (const step of block.steps) {
    if (step.reviewedMd5 !== live.md5) throw new Error(`Danh mục bước ${step.id} của ${live.name}: md5 đã duyệt khác code đang chạy`)
  }
}
if (BLOCKS[0].stepRows !== 0) throw new Error('Block tìm nhóm có dòng danh mục bước, chưa xử lý')
const COMMENT = BLOCKS[1]
const ADJUST = BLOCKS[2]
if (ADJUST.steps.length !== 0 || ADJUST.stepRows !== 0) throw new Error('Block chỉnh comment có dòng danh mục bước, chưa xử lý')
if (COMMENT.steps.length !== 1 || COMMENT.steps[0].commitLevel !== 2 || JSON.stringify(COMMENT.steps[0].sendOps) !== '["press:Enter"]') {
  throw new Error('Danh mục bước của block comment khác bản đã đọc (mức 2, gửi bằng Enter)')
}

// ------------------------------------------------------------------------------------------------ dấu hiệu FB11
const OLD_SIGNS = LIVE.signs.value
if (md5(OLD_SIGNS) !== LIVE.signs.md5) throw new Error('Fixture: md5 dòng dấu hiệu không khớp')
const oldSigns = JSON.parse(OLD_SIGNS)
if (oldSigns.some(sign => sign.code === FB11)) throw new Error('Dòng dấu hiệu đã có FB11')
const FB11_SIGN = { code: FB11, source: 'page', actions: ['fb_post_group'], phases: [], replaces: [FB40], texts: ['Tham gia nhóm', 'Join group'] }
const NEW_SIGNS = JSON.stringify([...oldSigns, FB11_SIGN])
const NEW_SIGNS_MD5 = md5(NEW_SIGNS)
const SIGN_COUNT = oldSigns.length + 1

// ------------------------------------------------------------------------------------------------ chính sách FB11 khi đăng nhóm = FB40
const fb40 = LIVE.policies.fb40
if (fb40.row.error_code !== FB40 || fb40.row.action_code != null || fb40.row.source !== 'v559_fb_draft') throw new Error('Fixture: dòng FB40 không phải dòng chung V559')
const fb11Title = LIVE.errors.find(e => e.code === FB11)
if (!fb11Title || fb11Title.title !== FB11_TITLE || fb11Title.help !== null || fb11Title.public !== 'FB11') throw new Error('Fixture: câu cho khách FB11 không phải câu anh duyệt')
/** Cột chép nguyên từ dòng FB40 (mọi cột chính sách, trừ khoá / câu / mô tả / sổ). */
const COPY_COLUMNS = ['error_class', 'status_id', 'campaign_action_id', 'runtime_target', 'detail_mode', 'detail_status_id', 'sub_status_id',
  'quota_effect', 'target_streak_effect', 'streak_threshold', 'target_effect', 'requeue_after_minutes', 'remaining_steps', 'lock_action_codes',
  'lock_mode', 'lock_minutes', 'lock_days', 'lock_time', 'run_effect', 'pace_mode', 'pace_seconds', 'campaign_effect', 'campaign_hold_minutes',
  'account_effect', 'login_effect', 'streak_after_delivery']
const DESCRIPTION = '[anh chốt 17/11, V563] FB11 khi đăng nhóm: có chỗ phát (dấu hiệu: không thấy ô đăng bài (FB40) mà trang có nút "Tham gia nhóm" / '
  + '"Join group"); giữ cách xử lý như FB40 hôm nay, chỉ đổi câu cho khách.'
const ROW_SQL = `md5(jsonb_strip_nulls(to_jsonb(p) - 'id' - 'created_at' - 'updated_at' - 'updated_by' - 'revision')::text)`
const RESOLVE_KEYS_DROPPED = `- 'policy_ids' - 'revisions' - 'log_template' - 'campaign_note_template'`
const sqlText = value => `'${String(value).replace(/'/g, "''")}'`

const HEADER = `-- V563: engine v2 Facebook, sửa riêng phần engine (bộ cũ không đổi): bản "[engine] fb_collect_search_groups" đọc số bài/ngày + tên nhóm
-- giao diện tiếng Anh; bản "[engine] fb_comment_at_position" chỉ comment "bài của mình" khi thấy đúng bài vừa đăng (không comment nhầm bài người
-- khác); bản "[engine] fb_adjust_group_post_comments_after_pending" bỏ lượt comment "bài của mình" khi chưa lấy được link bài vừa đăng và báo
-- khách một câu ⚠️; dấu hiệu FB11 "Tham gia nhóm" khi đăng nhóm không thấy ô đăng bài (chính sách = FB40, chỉ đổi câu).
-- SINH TỪ scripts/build-v563-sql.cjs (nguồn guard: scripts/fixtures/engine-v2-facebook/v563-live-20261117.json), không sửa tay.
-- Rà soát và số liệu: docs/ENGINE_V2_FACEBOOK_ERROR_REVIEW_20261117.md. Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST).
-- Bộ cũ không nạp block "[engine]" và không đọc ${SIGNS_KEY}. Desktop đọc lại block / dấu hiệu / danh mục ở lần nạp danh mục kế tiếp.
-- Gỡ: rollback_v563_engine_facebook_signs_search.sql.`

const blockPre = BLOCKS.map(block => `  SELECT count(*) INTO v_n FROM public.auto_blocks b JOIN public.auto_engine_block_copies c ON c.engine_block_id = b.id
   WHERE b.id = ${block.live.id} AND b.name = ${sqlText(block.live.name)} AND md5(b.code) = '${block.oldMd5}';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V563: block % (%) không còn đúng bản đã đọc (md5 ${block.oldMd5}), đọc lại và sinh lại', ${block.live.id}, ${sqlText(block.live.name)}; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = ${block.live.id};
  IF v_n <> ${block.steps.length} THEN RAISE EXCEPTION 'V563: block ${block.live.id} có % dòng danh mục bước, cần ${block.steps.length}', v_n; END IF;
${block.steps.map(step => `  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = ${step.id} AND block_id = ${block.live.id} AND commit_level = ${step.commitLevel}
                   AND send_ops = '${JSON.stringify(step.sendOps)}'::jsonb AND reviewed_code_md5 = '${block.oldMd5}') THEN
    RAISE EXCEPTION 'V563: dòng danh mục bước ${step.id} của block ${block.live.id} khác bản đã đọc';
  END IF;`).join('\n')}`).join('\n')

const blockUpdates = BLOCKS.map(block => `UPDATE public.auto_blocks SET code = ${block.tag}${block.newCode}${block.tag}, updated_at = now()
 WHERE id = ${block.live.id} AND md5(code) = '${block.oldMd5}';
${block.steps.map(step => `UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${block.newMd5}', updated_at = now()
 WHERE id = ${step.id} AND block_id = ${block.live.id} AND reviewed_code_md5 = '${block.oldMd5}';`).join('\n')}`).join('\n\n')

const blockPost = BLOCKS.map(block => `  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${block.live.id} AND md5(code) = '${block.newMd5}') THEN
    RAISE EXCEPTION 'V563 postflight: code block ${block.live.id} không phải bản mới (md5 ${block.newMd5})';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${block.live.id} AND reviewed_code_md5 IS DISTINCT FROM '${block.newMd5}') THEN
    RAISE EXCEPTION 'V563 postflight: danh mục bước của block ${block.live.id} chưa ghi md5 bản mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${block.live.sourceId} AND md5(code) = '${block.live.sourceMd5}') THEN
    RAISE EXCEPTION 'V563 postflight: block bộ cũ ${block.live.sourceId} đã đổi (V563 không được đụng bộ cũ)';
  END IF;`).join('\n')

/** Dấu hiệu + chính sách FB11 (bộ kiểm engine Desktop chạy riêng phần này vì DB thử của nó có block giả cùng số với block bộ cũ). */
const SIGN_POLICY_SQL = `-- 3. Dấu hiệu FB11: nút "Tham gia nhóm" / "Join group" trên trang khi đăng nhóm ra FB40.
UPDATE public.auto_system_settings SET value = ${sqlText(NEW_SIGNS)}, updated_at = now()
 WHERE key = ${sqlText(SIGNS_KEY)} AND md5(value) = '${LIVE.signs.md5}';

-- 4. Chính sách FB11 khi đăng nhóm: chép nguyên dòng FB40 chung, đổi câu cho khách.
INSERT INTO public.auto_outcome_policies (error_code, action_code, ${COPY_COLUMNS.join(', ')}, log_template, campaign_note_template,
  description, source, is_active, is_delete)
SELECT '${FB11}', 'fb_post_group', ${COPY_COLUMNS.map(c => `p.${c}`).join(', ')}, ${sqlText(FB11_TITLE)}, ${sqlText(FB11_TITLE)},
  ${sqlText(DESCRIPTION)}, '${SOURCE}', true, false
  FROM public.auto_outcome_policies p
 WHERE p.error_code = '${FB40}' AND p.action_code IS NULL AND p.campaign_action_id IS NULL AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete
   AND ${ROW_SQL} = '${fb40.md5}';`

const migration = `${HEADER}
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v563_%') THEN
      RAISE EXCEPTION 'V563 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_engine_block_copies') IS NULL OR to_regprocedure('public.aka_agent_engine_resolve_policy(text, bigint, text, text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'V563 cần V556–V560 (sổ chép block, hàm chọn chính sách engine)';
  END IF;
  -- Block: đúng bản engine đã đọc, là bản chép trong sổ; danh mục bước đúng bản đã đọc.
${blockPre}
  -- Dòng dấu hiệu: đúng bản V559.
  IF NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = ${sqlText(SIGNS_KEY)} AND md5(value) = '${LIVE.signs.md5}') THEN
    RAISE EXCEPTION 'V563: dòng ${SIGNS_KEY} đã đổi so với bản đã đọc (md5 ${LIVE.signs.md5})';
  END IF;
  -- Chính sách: đúng một dòng FB40 chung (V559, bản đã đọc); chưa có dòng FB11 riêng cho đăng nhóm; câu FB11 là câu anh duyệt.
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies p
   WHERE p.error_code = '${FB40}' AND p.action_code IS NULL AND p.campaign_action_id IS NULL AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete
     AND ${ROW_SQL} = '${fb40.md5}';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V563: dòng chính sách FB40 chung không còn đúng bản đã đọc'; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = '${FB11}' AND action_code = 'fb_post_group' AND NOT is_delete) THEN
    RAISE EXCEPTION 'V563: đã có chính sách FB11 cho đăng nhóm';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = '${FB11}' AND public_code = 'FB11' AND is_active AND NOT is_delete
                   AND customer_title = ${sqlText(FB11_TITLE)} AND customer_help IS NULL) THEN
    RAISE EXCEPTION 'V563: mã FB11 không bật hoặc câu cho khách không phải câu anh duyệt';
  END IF;
END $pre$;

-- 1–2. Bản engine của block tìm nhóm bằng search và block comment theo vị trí (bộ cũ: block ${BLOCKS.map(b => b.live.sourceId).join(', ')} giữ nguyên);
-- danh mục bước của block comment ghi md5 bản đã duyệt mới (mức cam kết 2, gửi bằng Enter như cũ).
${blockUpdates}

${SIGN_POLICY_SQL}

DO $post$
DECLARE v_n integer; v_phase text; v_mine jsonb; v_today jsonb;
BEGIN
${blockPost}
  SELECT count(*) INTO v_n FROM public.auto_system_settings WHERE key = ${sqlText(SIGNS_KEY)} AND md5(value) = '${NEW_SIGNS_MD5}'
     AND jsonb_array_length(value::jsonb) = ${SIGN_COUNT};
  IF v_n <> 1 THEN RAISE EXCEPTION 'V563 postflight: dòng ${SIGNS_KEY} không phải bản mới (${SIGN_COUNT} dấu hiệu)'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE source = '${SOURCE}' AND error_code = '${FB11}' AND action_code = 'fb_post_group'
     AND is_active AND NOT is_delete;
  IF v_n <> 1 THEN RAISE EXCEPTION 'V563 postflight: cần đúng 1 dòng chính sách FB11 cho đăng nhóm, có %', v_n; END IF;
  -- Chính sách hiệu lực của FB11 khi đăng nhóm = FB40 (trừ câu cho khách) ở mọi pha.
  FOREACH v_phase IN ARRAY ARRAY['before_send', 'in_flight', 'after_send'] LOOP
    v_mine := public.aka_agent_engine_resolve_policy('${FB11}', NULL, 'fb_post_group', NULL, 'desktop', v_phase) ${RESOLVE_KEYS_DROPPED};
    v_today := public.aka_agent_engine_resolve_policy('${FB40}', NULL, 'fb_post_group', NULL, 'desktop', v_phase) ${RESOLVE_KEYS_DROPPED};
    IF v_mine IS DISTINCT FROM v_today THEN
      RAISE EXCEPTION 'V563 postflight: chính sách FB11 khi đăng nhóm khác FB40 ở pha %: % / %', v_phase, v_mine, v_today;
    END IF;
  END LOOP;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V563: trả bản "[engine] fb_collect_search_groups", "[engine] fb_comment_at_position" (kèm md5 đã duyệt của danh mục bước) và dòng
-- ${SIGNS_KEY} về bản trước V563, xoá chính sách FB11 khi đăng nhóm (V563). Chỉ chạy khi các thứ đó đang đúng bản V563 (đã ai sửa sau V563 thì
-- dừng, không ghi đè). Bộ cũ không đổi. SINH TỪ scripts/build-v563-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
${BLOCKS.map(block => `  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${block.live.id} AND md5(code) = '${block.newMd5}') THEN
    RAISE EXCEPTION 'Gỡ V563: block ${block.live.id} không phải bản V563 (md5 ${block.newMd5}), không ghi đè';
  END IF;`).join('\n')}
  IF NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = ${sqlText(SIGNS_KEY)} AND md5(value) = '${NEW_SIGNS_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V563: dòng ${SIGNS_KEY} không phải bản V563, không ghi đè';
  END IF;
END $pre$;

${BLOCKS.map(block => `UPDATE public.auto_blocks SET code = ${block.tag}${block.live.code}${block.tag}, updated_at = now()
 WHERE id = ${block.live.id} AND md5(code) = '${block.newMd5}';
${block.steps.map(step => `UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${block.oldMd5}', updated_at = now()
 WHERE id = ${step.id} AND block_id = ${block.live.id} AND reviewed_code_md5 = '${block.newMd5}';`).join('\n')}`).join('\n\n')}
UPDATE public.auto_system_settings SET value = ${sqlText(OLD_SIGNS)}, updated_at = now()
 WHERE key = ${sqlText(SIGNS_KEY)} AND md5(value) = '${NEW_SIGNS_MD5}';
DELETE FROM public.auto_outcome_policies WHERE source = '${SOURCE}' AND error_code = '${FB11}' AND action_code = 'fb_post_group';

DO $post$
BEGIN
${BLOCKS.map(block => `  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${block.live.id} AND md5(code) = '${block.oldMd5}') THEN
    RAISE EXCEPTION 'Gỡ V563 postflight: block ${block.live.id} chưa về bản trước V563';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${block.live.id} AND reviewed_code_md5 IS DISTINCT FROM '${block.oldMd5}') THEN
    RAISE EXCEPTION 'Gỡ V563 postflight: danh mục bước của block ${block.live.id} chưa về md5 cũ';
  END IF;`).join('\n')}
  IF NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = ${sqlText(SIGNS_KEY)} AND md5(value) = '${LIVE.signs.md5}') THEN
    RAISE EXCEPTION 'Gỡ V563 postflight: dòng ${SIGNS_KEY} chưa về bản V559';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = '${SOURCE}') THEN
    RAISE EXCEPTION 'Gỡ V563 postflight: còn chính sách của V563';
  END IF;
END $post$;

COMMIT;
`

const SEARCH = BLOCKS[0]
module.exports = {
  LIVE, BLOCKS, SEARCH, COMMENT, ADJUST, OWN_POST_SKIP_MESSAGE,
  // Giữ tên cũ cho bài kiểm block tìm nhóm.
  EDITS: SEARCH.edits, OLD_MD5: SEARCH.oldMd5, NEW_MD5: SEARCH.newMd5, newCode: SEARCH.newCode,
  OLD_SIGNS, NEW_SIGNS, FB11_SIGN, SIGN_COUNT, SOURCE, FB11, FB40, FB11_TITLE, SIGN_POLICY_SQL, migration, rollback
}
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations/migration_v563_engine_facebook_signs_search.sql'), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v563_engine_facebook_signs_search.sql'), rollback)
  console.log(`V563: ${BLOCKS.map(b => `block ${b.live.id} ${b.oldMd5} → ${b.newMd5}`).join('; ')}; dấu hiệu ${LIVE.signs.md5} → ${NEW_SIGNS_MD5} (${SIGN_COUNT}); `
    + `migration ${md5(migration)}, rollback ${md5(rollback)}`)
}
