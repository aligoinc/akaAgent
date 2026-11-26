#!/usr/bin/env node
// V663: engine v2 Facebook, nhóm FB06 chuyển sang Page (câu 605 / 2843 / 637 / 632 / 609 / 610 / 3186 của bộ kiểm lỗi, anh chốt 26/11/2026).
//
// Đo trên production 19–26/11 (chỉ đọc): 54 lượt FB06 ở bước __identity, cả 54 lần tạm dừng chiến dịch. Block "[engine]
// fb_get_current_identity_name" (2879) và "[engine] fb_switch_identity_by_name" (2880), chép nguyên từ bộ cũ 2670 / 2671, bấm nút menu ngay sau
// khi mở trang rồi ngủ cố định stepMs + 500 (1,5 giây) và đọc / bấm đúng một lần: "không lấy được tên" 16 lượt, "không thấy nút xem tất cả" 15,
// "ô tìm kiếm trang hết giờ" 4. Ảnh + DOM lỗi xin 26/11 (yêu cầu 35–38, app 10.6.0): menu tài khoản đã mở nhưng còn khung xám đang tải; DOM chụp
// khoảng một giây sau ở bước kế đã có đủ nút xem tất cả và link tên, XPath 1536–1540 khớp. 8 lượt tài khoản đã đứng sẵn ở đúng Page cần dùng mà
// block vẫn mở danh sách chọn lại chính nó (3/4 lượt "ô tìm kiếm trang hết giờ").
//
// Sửa (anh chốt từng việc 26/11):
//   - Block 2879 / 2880: chờ phần tử hiện thay cho ngủ cố định (nút menu, link tên, nút xem tất cả tối đa 10 giây; mục tên Page 8 giây rồi mới
//     gõ ô tìm kiếm, sau khi gõ lại chờ 8 giây); không thấy link tên / nút xem tất cả thì đóng / mở menu lại một lần. Mở / đóng menu theo
//     aria-expanded của nút menu (đang mở thì không bấm nữa), không có thuộc tính đó thì bấm như cũ. Câu lỗi giữ nguyên.
//   - Block 2880: tên danh tính hiện tại (2879 vừa đọc) trùng tên cần chuyển thì trả ok ngay, không mở menu; chuyển về danh tính ban đầu mà
//     danh tính ban đầu chính là Page của chiến dịch (runAsPageName), hoặc cùng lượt vừa bỏ qua bước chuyển, thì cũng trả ok ngay.
//   - Danh mục bước của 2880 (dòng 24, session): reviewed_code_md5 theo code mới.
//   - Câu FB06 cho khách bỏ "để đăng bài" (chiến dịch tham gia nhóm / bình luận cũng dùng): chính sách 284 (ghi chú chiến dịch, dòng tiến trình)
//     và tên mã cho khách auto_error 65. Cách xử lý FB06 (tạm dừng chiến dịch ngay) giữ nguyên.
// Bộ cũ (2670 / 2671) không đổi; sổ chép block giữ nguyên (như V598 / V607 / V658).
//
// Nguồn guard: scripts/fixtures/engine-v2-facebook/v663-live-20261126.json (đọc chỉ đọc production 26/11). Code mới:
// scripts/engine-v2-facebook/v663-get-identity.block.js, v663-switch-identity.block.js. Code block không ghi số migration (đổi số không đổi md5
// code); kiểm lại sổ ngay trước khi apply. Chạy: node scripts/build-v663-sql.cjs (ghi migration + bản gỡ).
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/v663-live-20261126.json'), 'utf8'))
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const NAME = 'migration_v663_engine_facebook_page_identity_wait'
const ROLLBACK_NAME = 'rollback_v663_engine_facebook_page_identity_wait'

const GET = { ...LIVE.blocks.get, newCode: fs.readFileSync(path.join(ROOT, 'scripts/engine-v2-facebook/v663-get-identity.block.js'), 'utf8') }
const SWITCH = { ...LIVE.blocks.switch, newCode: fs.readFileSync(path.join(ROOT, 'scripts/engine-v2-facebook/v663-switch-identity.block.js'), 'utf8') }
for (const [block, id, name, source] of [[GET, 2879, '[engine] fb_get_current_identity_name', LIVE.sources.get], [SWITCH, 2880, '[engine] fb_switch_identity_by_name', LIVE.sources.switch]]) {
  if (block.id !== id || block.name !== name) throw new Error(`Fixture: block ${block.id} khác ${id} ${name}`)
  if (md5(block.code) !== block.md5) throw new Error(`Fixture: code block ${id} khác md5 ghi kèm`)
  if (source.md5 !== block.md5) throw new Error(`Fixture: block ${id} không còn đúng bản chép từ bộ cũ ${source.id}`)
  if (!LIVE.copies.some(c => c.engineBlockId === id && c.sourceBlockId === source.id && c.engineMd5AtCopy === block.md5)) {
    throw new Error(`Fixture: sổ chép block thiếu ${source.id} → ${id}`)
  }
  block.oldMd5 = block.md5
  block.newMd5 = md5(block.newCode)
  if (block.newCode.normalize('NFC') !== block.newCode) throw new Error(`Code block ${id} mới có chữ không ở dạng NFC`)
  // Code block phải dựng được thành hàm async (đúng cách workflowEngine chạy block).
  try {
    new Function('page', 'helpers', 'vars', 'input', 'signal', `return (async () => {\n${block.newCode}\n})`)
  } catch (error) {
    throw new Error(`Code block ${id} mới không hợp lệ: ${error.message}`)
  }
}
// Câu lỗi giữ nguyên (khoá ca lỗi, luật, câu khách đang thấy gộp theo câu).
for (const text of ["'Không tìm thấy nút mở menu profile/page hiện tại'", "'Không lấy được tên Facebook identity hiện tại'"]) {
  if (!GET.code.includes(text) || !GET.newCode.includes(text)) throw new Error(`Block 2879: câu lỗi ${text} phải giữ nguyên`)
}
for (const text of ["'Không tìm thấy nút mở menu profile/page hiện tại'", "'Không tìm thấy nút xem tất cả profile/page'",
  "'Không tìm thấy page/profile \"' + identityName + '\"'", "'Có lỗi xảy ra khi chọn page/profile: ' + message",
  "'Không có tên profile gốc để chuyển lại'", "'Thiếu tên identity/page cần chuyển'"]) {
  if (!SWITCH.code.includes(text) || !SWITCH.newCode.includes(text)) throw new Error(`Block 2880: câu lỗi ${text} phải giữ nguyên`)
}
const ELEMENT_NAMES = ['FbIdentityMenuButton', 'FbCurrentIdentityLink', 'FbIdentitySeeAllButton', 'FbIdentitySearchInput', 'FbIdentitySelectByNameButton']
for (const name of ELEMENT_NAMES) {
  if (typeof LIVE.elements[name] !== 'string') throw new Error(`Fixture: thiếu element ${name}`)
  const uses = block => block.newCode.includes(`helpers.element('${name}')`)
  if (!uses(GET) && !uses(SWITCH)) throw new Error(`Element ${name} không còn được dùng`)
}

if (LIVE.steps.length !== 1) throw new Error('Fixture: block 2879 / 2880 phải có đúng một dòng danh mục bước (2880, session)')
const STEP = LIVE.steps[0]
if (STEP.blockId !== 2880 || STEP.stepKind !== 'session' || STEP.reviewedMd5 !== SWITCH.oldMd5 || STEP.active !== true || STEP.workflowId !== null
  || STEP.nodeId !== null) throw new Error('Fixture: danh mục bước của 2880 khác bản đã đọc (session, md5 bộ cũ)')

const ENGINE_WORKFLOWS = [316, 317, 318, 319, 321, 322, 326]
if (JSON.stringify(LIVE.workflowsUsing.map(w => w.id)) !== JSON.stringify(ENGINE_WORKFLOWS)) throw new Error('Fixture: workflow dùng 2879 / 2880 khác bản đã đọc')

const POLICY = LIVE.policies.find(p => p.id === 284)
const OLD_LOG = 'Không chuyển được sang Page để đăng bài'
const NEW_LOG = 'Không chuyển được sang Page đã chọn'
const OLD_NOTE = 'Không chuyển được sang Page để đăng bài (FB06). Kiểm tra tài khoản còn quản lý Page này và tên Page trong chiến dịch đã đúng chưa, rồi bấm Tiếp tục chiến dịch.'
const NEW_NOTE = 'Không chuyển được sang Page đã chọn (FB06). Kiểm tra tài khoản còn quản lý Page này và tên Page trong chiến dịch đã đúng chưa, rồi bấm Tiếp tục chiến dịch.'
if (!POLICY || POLICY.errorCode !== 'err_fb_identity_switch_failed' || !POLICY.active || POLICY.deleted || POLICY.actionCode || POLICY.campaignActionId
  || POLICY.campaignEffect !== 'pause' || POLICY.targetEffect !== 'requeue' || POLICY.logTemplate !== OLD_LOG || POLICY.noteTemplate !== OLD_NOTE) {
  throw new Error('Fixture: chính sách 284 (FB06) khác bản đã đọc')
}
if (LIVE.policies.some(p => p.id !== 284 && p.active && !p.deleted)) throw new Error('Fixture: FB06 có chính sách đang bật khác 284')
const ERROR = LIVE.error
const OLD_TITLE = 'Không chuyển được sang Page để đăng bài'
const NEW_TITLE = 'Không chuyển được sang Page đã chọn'
if (ERROR.id !== 65 || ERROR.publicCode !== 'FB06' || ERROR.customerTitle !== OLD_TITLE) throw new Error('Fixture: mã FB06 (auto_error 65) khác bản đã đọc')

const TAG = '$v663_identity$'
for (const block of [GET, SWITCH]) {
  if (block.code.includes(TAG) || block.newCode.includes(TAG)) throw new Error('Code block chứa thẻ dollar-quote')
}
const sqlText = value => `'${String(value).replace(/'/g, "''")}'`
const SOURCE_GUARD = [LIVE.sources.get, LIVE.sources.switch].map(s => `(${s.id}, '${s.md5}')`).join(', ')
const ELEMENT_GUARD = ELEMENT_NAMES.map(name => `(${sqlText(name)}, ${sqlText(LIVE.elements[name])})`).join(',\n      ')

const preflight = `DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v663_%') THEN
      RAISE EXCEPTION 'V663 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_engine_block_copies') IS NULL OR to_regclass('public.auto_engine_block_steps') IS NULL THEN
    RAISE EXCEPTION 'V663 cần V556–V560 (sổ chép block, danh mục bước)';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_blocks b JOIN public.auto_engine_block_copies c ON c.engine_block_id = b.id
   WHERE (b.id, b.name, c.source_block_id, md5(b.code)) IN ((${GET.id}, ${sqlText(GET.name)}, ${LIVE.sources.get.id}, '${GET.oldMd5}'),
     (${SWITCH.id}, ${sqlText(SWITCH.name)}, ${LIVE.sources.switch.id}, '${SWITCH.oldMd5}'));
  IF v_n <> 2 THEN RAISE EXCEPTION 'V663: block ${GET.id} / ${SWITCH.id} không còn đúng bản production (md5 ${GET.oldMd5} / ${SWITCH.oldMd5}), đọc lại và sinh lại'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_blocks WHERE (id, md5(code)) IN (${SOURCE_GUARD});
  IF v_n <> 2 THEN RAISE EXCEPTION 'V663: block bộ cũ ${LIVE.sources.get.id} / ${LIVE.sources.switch.id} khác bản đã đọc'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id IN (${GET.id}, ${SWITCH.id});
  IF v_n <> 1 OR NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = ${STEP.id} AND block_id = ${SWITCH.id} AND step_kind = 'session'
     AND is_active AND workflow_id IS NULL AND node_id IS NULL AND reviewed_code_md5 = '${SWITCH.oldMd5}') THEN
    RAISE EXCEPTION 'V663: danh mục bước của block ${GET.id} / ${SWITCH.id} khác bản đã đọc (một dòng session ${STEP.id})';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_elements WHERE (name, xpath) IN (
      ${ELEMENT_GUARD});
  IF v_n <> ${ELEMENT_NAMES.length} THEN RAISE EXCEPTION 'V663: element danh tính Facebook (FbIdentity*) khác bản đã đọc'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE id = ${POLICY.id} AND error_code = 'err_fb_identity_switch_failed' AND is_active
     AND NOT is_delete AND action_code IS NULL AND campaign_action_id IS NULL AND campaign_effect = 'pause' AND target_effect = 'requeue'
     AND log_template = ${sqlText(OLD_LOG)} AND campaign_note_template = ${sqlText(OLD_NOTE)}) THEN
    RAISE EXCEPTION 'V663: chính sách ${POLICY.id} (FB06) khác bản đã đọc';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE error_code = 'err_fb_identity_switch_failed' AND is_active AND NOT is_delete;
  IF v_n <> 1 THEN RAISE EXCEPTION 'V663: FB06 có % chính sách đang bật (cần đúng 1: ${POLICY.id})', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE id = ${ERROR.id} AND error_code = 'err_fb_identity_switch_failed' AND public_code = 'FB06'
     AND customer_title = ${sqlText(OLD_TITLE)}) THEN
    RAISE EXCEPTION 'V663: mã FB06 (auto_error ${ERROR.id}) khác bản đã đọc';
  END IF;
END $pre$;`

const migration = `-- V663: engine v2 Facebook, nhóm FB06 chuyển sang Page (câu 605 / 2843 / 637 / 632 / 609 / 610 / 3186 của bộ kiểm lỗi, anh chốt 26/11/2026).
-- Block "[engine] fb_get_current_identity_name" (${GET.id}) và "[engine] fb_switch_identity_by_name" (${SWITCH.id}): chờ menu tài khoản / danh sách trang
-- cá nhân tải xong thay cho ngủ cố định 1,5 giây (ảnh + DOM lỗi 26/11: menu còn khung xám lúc bấm), đóng / mở menu lại một lần; tài khoản đã ở
-- sẵn đúng Page thì không chuyển (và không chuyển về khi danh tính ban đầu chính là Page đó). Câu lỗi giữ nguyên. Danh mục bước của ${SWITCH.id} theo
-- code mới. Câu FB06 cho khách bỏ "để đăng bài" (chính sách ${POLICY.id}, auto_error ${ERROR.id}); cách xử lý FB06 giữ nguyên (tạm dừng chiến dịch).
-- Bộ cũ (${LIVE.sources.get.id} / ${LIVE.sources.switch.id}) và sổ chép block không đổi.
-- SINH TỪ scripts/build-v663-sql.cjs (nguồn guard: scripts/fixtures/engine-v2-facebook/v663-live-20261126.json), không sửa tay.
-- Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST). Desktop đọc code block mỗi lượt. Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight}

UPDATE public.auto_blocks SET code = ${TAG}${GET.newCode}${TAG}, updated_at = now()
 WHERE id = ${GET.id} AND md5(code) = '${GET.oldMd5}';

UPDATE public.auto_blocks SET code = ${TAG}${SWITCH.newCode}${TAG}, updated_at = now()
 WHERE id = ${SWITCH.id} AND md5(code) = '${SWITCH.oldMd5}';

UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${SWITCH.newMd5}', updated_at = now()
 WHERE id = ${STEP.id} AND block_id = ${SWITCH.id} AND reviewed_code_md5 = '${SWITCH.oldMd5}';

UPDATE public.auto_outcome_policies SET log_template = ${sqlText(NEW_LOG)}, campaign_note_template = ${sqlText(NEW_NOTE)}, updated_at = now()
 WHERE id = ${POLICY.id} AND log_template = ${sqlText(OLD_LOG)} AND campaign_note_template = ${sqlText(OLD_NOTE)};

UPDATE public.auto_error SET customer_title = ${sqlText(NEW_TITLE)}, updated_at = now()
 WHERE id = ${ERROR.id} AND customer_title = ${sqlText(OLD_TITLE)};

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${GET.id} AND md5(code) = '${GET.newMd5}')
     OR NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${SWITCH.id} AND md5(code) = '${SWITCH.newMd5}') THEN
    RAISE EXCEPTION 'V663 postflight: code block ${GET.id} / ${SWITCH.id} không phải bản mới (md5 ${GET.newMd5} / ${SWITCH.newMd5})';
  END IF;
  IF (SELECT count(*) FROM public.auto_blocks WHERE (id, md5(code)) IN (${SOURCE_GUARD})) <> 2 THEN
    RAISE EXCEPTION 'V663 postflight: block bộ cũ đã đổi (V663 không được đụng bộ cũ)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${SWITCH.id} AND reviewed_code_md5 IS DISTINCT FROM '${SWITCH.newMd5}') THEN
    RAISE EXCEPTION 'V663 postflight: danh mục bước của block ${SWITCH.id} chưa theo code mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE id = ${POLICY.id} AND is_active AND campaign_effect = 'pause' AND target_effect = 'requeue'
     AND log_template = ${sqlText(NEW_LOG)} AND campaign_note_template = ${sqlText(NEW_NOTE)}) THEN
    RAISE EXCEPTION 'V663 postflight: câu chính sách ${POLICY.id} chưa đổi hoặc cách xử lý FB06 bị đổi';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE id = ${ERROR.id} AND customer_title = ${sqlText(NEW_TITLE)}) THEN
    RAISE EXCEPTION 'V663 postflight: tên mã FB06 cho khách chưa đổi';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V663: trả block ${GET.id} / ${SWITCH.id} về bản production trước V663 (= bộ cũ, md5 ${GET.oldMd5} / ${SWITCH.oldMd5}), danh mục bước của ${SWITCH.id},
-- câu chính sách ${POLICY.id} và tên mã FB06 (auto_error ${ERROR.id}) về câu cũ. Chỉ chạy khi mọi thứ đang đúng bản V663 (đã ai sửa sau V663 thì dừng,
-- không ghi đè). Bộ cũ không đổi. SINH TỪ scripts/build-v663-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${GET.id} AND md5(code) = '${GET.newMd5}')
     OR NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${SWITCH.id} AND md5(code) = '${SWITCH.newMd5}') THEN
    RAISE EXCEPTION 'Gỡ V663: block ${GET.id} / ${SWITCH.id} không phải bản V663, không ghi đè';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = ${STEP.id} AND block_id = ${SWITCH.id} AND reviewed_code_md5 = '${SWITCH.newMd5}') THEN
    RAISE EXCEPTION 'Gỡ V663: danh mục bước ${STEP.id} không phải bản V663';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE id = ${POLICY.id} AND log_template = ${sqlText(NEW_LOG)} AND campaign_note_template = ${sqlText(NEW_NOTE)}) THEN
    RAISE EXCEPTION 'Gỡ V663: câu chính sách ${POLICY.id} không phải bản V663';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE id = ${ERROR.id} AND customer_title = ${sqlText(NEW_TITLE)}) THEN
    RAISE EXCEPTION 'Gỡ V663: tên mã FB06 không phải bản V663';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = ${TAG}${GET.code}${TAG}, updated_at = now()
 WHERE id = ${GET.id} AND md5(code) = '${GET.newMd5}';

UPDATE public.auto_blocks SET code = ${TAG}${SWITCH.code}${TAG}, updated_at = now()
 WHERE id = ${SWITCH.id} AND md5(code) = '${SWITCH.newMd5}';

UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${SWITCH.oldMd5}', updated_at = now()
 WHERE id = ${STEP.id} AND block_id = ${SWITCH.id} AND reviewed_code_md5 = '${SWITCH.newMd5}';

UPDATE public.auto_outcome_policies SET log_template = ${sqlText(OLD_LOG)}, campaign_note_template = ${sqlText(OLD_NOTE)}, updated_at = now()
 WHERE id = ${POLICY.id} AND log_template = ${sqlText(NEW_LOG)} AND campaign_note_template = ${sqlText(NEW_NOTE)};

UPDATE public.auto_error SET customer_title = ${sqlText(OLD_TITLE)}, updated_at = now()
 WHERE id = ${ERROR.id} AND customer_title = ${sqlText(NEW_TITLE)};

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${GET.id} AND md5(code) = '${GET.oldMd5}')
     OR NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${SWITCH.id} AND md5(code) = '${SWITCH.oldMd5}') THEN
    RAISE EXCEPTION 'Gỡ V663 postflight: block ${GET.id} / ${SWITCH.id} chưa về bản trước V663';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${SWITCH.id} AND reviewed_code_md5 IS DISTINCT FROM '${SWITCH.oldMd5}')
     OR NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE id = ${POLICY.id} AND log_template = ${sqlText(OLD_LOG)} AND campaign_note_template = ${sqlText(OLD_NOTE)})
     OR NOT EXISTS (SELECT 1 FROM public.auto_error WHERE id = ${ERROR.id} AND customer_title = ${sqlText(OLD_TITLE)}) THEN
    RAISE EXCEPTION 'Gỡ V663 postflight: danh mục bước / câu FB06 chưa về bản trước V663';
  END IF;
END $post$;

COMMIT;
`

module.exports = { NAME, ROLLBACK_NAME, LIVE, GET, SWITCH, STEP, POLICY, ERROR, OLD_LOG, NEW_LOG, OLD_NOTE, NEW_NOTE, OLD_TITLE, NEW_TITLE, migration, rollback }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log(`V663: block ${GET.id} ${GET.oldMd5} → ${GET.newMd5}; block ${SWITCH.id} ${SWITCH.oldMd5} → ${SWITCH.newMd5}; migration ${md5(migration)}, rollback ${md5(rollback)}`)
}
