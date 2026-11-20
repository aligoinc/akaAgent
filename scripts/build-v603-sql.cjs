#!/usr/bin/env node
// Sinh migration V603 (câu 570 của hộp thư lỗi, anh chốt 20/11/2026, docs/ENGINE_V2_FACEBOOK_MESSENGER_SIGNS_V603.md): nhắn tin bạn bè / theo UID
// hết giờ chờ ô nhập tin Messenger (FB42 "waitForSelector timeout: [role="textbox"]…") mà Facebook ghi lý do ngay chỗ ô nhập tin. Đọc 18 ảnh lỗi
// của chiến dịch 45597 (yêu cầu ảnh 9):
//   * "<tên> chưa thể truy cập vào đoạn chat này. Bạn sẽ có thể gửi tin nhắn trong lần tiếp theo <tên> đăng nhập vào Messenger" (4/18)
//     → FB19, mã nội bộ mới err_fb_messenger_recipient_cannot_access_chat, câu "Người này chưa đăng nhập Messenger nên chưa nhận được tin".
//   * "Bạn không thể nhắn tin cho tài khoản này. Bạn nên thêm họ làm bạn bè trên Facebook" (1/18)
//     → FB19 (mã có sẵn từ V346, chưa chỗ nào phát), câu "Facebook chỉ cho nhắn tin khi đã kết bạn với người này".
//   Cả hai: như FB26 hộp thư Page (đóng data, ghi thất bại, không tính lượt, không cộng chuỗi, chạy tiếp), áp cho nhắn tin bạn bè và theo UID.
// Đoạn chat cũ trước mã hoá đầu cuối có nút "Tiếp tục" (13/18) chưa đổi (anh: chờ DOM), vẫn FB42 như mọi trường hợp không thấy câu nào.
// Chỉ dữ liệu (không DDL, không nạp lại schema PostgREST), chỉ bản "[engine]" của block (bộ cũ block 38 không đổi), không cần phát hành app.
//   node scripts/build-v603-sql.cjs            ghi migration + bản gỡ
//   node scripts/build-v603-sql.cjs --check    chỉ kiểm file đang có khớp bộ sinh
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const NAME = 'migration_v603_engine_facebook_messenger_signs'
const ROLLBACK_NAME = 'rollback_v603_engine_facebook_messenger_signs'
const SOURCE = 'v603'
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const lit = text => text == null ? 'NULL' : `'${String(text).replace(/'/g, "''")}'`
const LIVE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/engine-v2-facebook/v603-live-20261120.json'), 'utf8'))

// Hai thao tác dùng chung block gửi tin 2855 (anh chốt áp cả nhắn theo UID). campaignAction: mã loại chiến dịch khi gộp chính sách.
const ACTIONS = [
  { code: 'fb_message_friend', campaignAction: 'facebook_message_friend', stepId: 15, workflowId: 323 },
  { code: 'fb_message_stranger', campaignAction: 'facebook_message_uid', stepId: 16, workflowId: 324 }
]
const BLOCK = { id: 2855, name: '[engine] fb_send_message', sourceId: 38, oldMd5: 'fb11e928304d044f50f3a11a93821463' }
const STEP = { commitLevel: 2, sendOps: ['press:Enter'] }
const SIGNS_BEFORE_MD5 = 'dc7fd786e225a7ca05c4a3cfa49852d7'
if (LIVE.block.id !== BLOCK.id || LIVE.block.name !== BLOCK.name || md5(LIVE.block.code) !== BLOCK.oldMd5) throw new Error('Fixture block 2855 lệch')
if (LIVE.copy.source_block_id !== BLOCK.sourceId || LIVE.copy.engine_block_id !== BLOCK.id) throw new Error('Fixture sổ chép lệch')
if (LIVE.steps.length !== ACTIONS.length || ACTIONS.some(a => !LIVE.steps.some(s => s.id === a.stepId && s.action_code === a.code
  && s.workflow_id === a.workflowId && s.commit_level === STEP.commitLevel && JSON.stringify(s.send_ops) === JSON.stringify(STEP.sendOps)
  && s.reviewed_code_md5 === BLOCK.oldMd5))) throw new Error('Fixture danh mục bước lệch')
if (md5(LIVE.signs.value) !== SIGNS_BEFORE_MD5 || LIVE.signs.md5 !== SIGNS_BEFORE_MD5) throw new Error('Fixture dấu hiệu lệch')

// Mã và câu anh duyệt qua hộp chọn 20/11/2026 ("2 câu theo chữ Facebook", cùng FB19, không có bước tiếp theo).
const FB19 = { code: 'err_fb_messenger_unavailable_target_not_messageable', pub: 'FB19', oldTitle: 'Người này không nhận tin nhắn từ tài khoản',
  title: 'Facebook chỉ cho nhắn tin khi đã kết bạn với người này' }
const NOT_ON_MESSENGER = { code: 'err_fb_messenger_recipient_cannot_access_chat', pub: 'FB19', cls: 'target_permanent',
  title: 'Người này chưa đăng nhập Messenger nên chưa nhận được tin' }
const FB42 = { code: 'err_engine_fb_action_failed', pub: 'FB42' }
const live19 = LIVE.errors.FB19
if (live19.error_code !== FB19.code || live19.customer_title !== FB19.oldTitle || live19.customer_help !== null || live19.error_class !== 'target_permanent')
  throw new Error('Fixture FB19 lệch')
if (LIVE.errors.FB42.error_code !== FB42.code) throw new Error('Fixture FB42 lệch')
if (LIVE.policies.some(p => p.error_code === FB19.code && ACTIONS.some(a => a.code === p.action_code))) throw new Error('Đã có chính sách FB19 cho nhắn tin')
const CODES = [NOT_ON_MESSENGER, FB19]
const note = c => `${c.title} (${c.pub}).`

// Element theo chữ Facebook ghi ở chỗ ô nhập tin (ảnh lỗi chiến dịch 45597, chưa có DOM: bản 10.1.0 của máy khách build trước #739). Sửa ở màn
// Element khi Facebook đổi chữ; bản tiếng Anh nối thêm bằng `|` khi có mẫu.
//   * Câu "chưa thể truy cập" mở đầu bằng tên người nhận nên so một phần câu.
//   * Câu "không thể nhắn tin" so đầu câu: câu thứ hai ("Bạn nên thêm họ làm bạn bè…") có thể khác ở nhắn theo UID.
const ELEMENTS = [
  { name: 'FbMessengerCannotAccessChatNotice', xpath: "//text()[contains(normalize-space(.), 'chưa thể truy cập vào đoạn chat này')]/..",
    description: 'V603: chữ Facebook ghi thay ô nhập tin Messenger khi người nhận chưa đăng nhập Messenger (FB19). Thêm bản tiếng Anh bằng | khi có mẫu.' },
  { name: 'FbMessengerFriendsOnlyNotice', xpath: "//text()[starts-with(normalize-space(.), 'Bạn không thể nhắn tin cho tài khoản này')]/..",
    description: 'V603: chữ Facebook ghi thay ô nhập tin Messenger khi chỉ nhắn được cho bạn bè (FB19). Thêm bản tiếng Anh bằng | khi có mẫu.' }
]
for (const e of ELEMENTS) if (LIVE.elements.some(x => x.name === e.name)) throw new Error(`Element ${e.name} đã có`)

// Câu block báo (cũng là chữ của dấu hiệu "message": câu dòng lịch sử "Lỗi nhắn tin đến <tên>: <câu>" chứa câu này).
const NOT_ON_MESSENGER_MESSAGE = NOT_ON_MESSENGER.title
const FRIENDS_ONLY_MESSAGE = FB19.title

const EDITS = [
  {
    from: '    throw textboxError\n  }\n',
    to: [
      '    // V603 (anh chốt 20/11/2026): Facebook bỏ ô nhập tin và ghi lý do ở chỗ đó. Nhận ra bằng chữ trên trang (element ở auto_elements),',
      '    // không đoán lý do; không thấy câu nào thì vẫn báo câu hết giờ như cũ.',
      '    const facebookNotice = async name => {',
      '      if (signal.aborted) return false',
      '      const xpath = await Promise.resolve().then(() => helpers.element(name)).catch(() => null)',
      '      if (!xpath) return false',
      "      return await page.evaluate('return document.evaluate(__args[0], document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength > 0;',",
      '        xpath).catch(() => false)',
      '    }',
      `    if (await facebookNotice('${ELEMENTS[0].name}')) throw new Error('${NOT_ON_MESSENGER_MESSAGE}')`,
      `    if (await facebookNotice('${ELEMENTS[1].name}')) throw new Error('${FRIENDS_ONLY_MESSAGE}')`,
      '    throw textboxError',
      '  }',
      ''
    ].join('\n')
  }
]
let NEW_CODE = LIVE.block.code
for (const edit of EDITS) {
  if (NEW_CODE.split(edit.from).length !== 2) throw new Error('Đoạn code cần sửa phải xuất hiện đúng một lần')
  NEW_CODE = NEW_CODE.replace(edit.from, edit.to)
}
for (const edit of EDITS) if (NEW_CODE.split(edit.to).length !== 2) throw new Error('Đoạn code mới phải xuất hiện đúng một lần')
const NEW_MD5 = md5(NEW_CODE)
const Q = '$v603$'
for (const text of [LIVE.block.code, NEW_CODE, ...EDITS.flatMap(e => [e.from, e.to])]) if (text.includes(Q)) throw new Error('Code chứa dấu nháy $v603$')
const dq = text => `${Q}${text}${Q}`

// Dấu hiệu mới nối cuối danh sách. Dòng lịch sử nhắn tin lỗi không mang mã (block trả ok:false, bộ dựng cũ ghi "thất bại"), nên replaces rỗng
// = chỉ gắn mã cho kết quả chưa có mã (FB01 giới hạn tin nhắn chờ vẫn đi đường riêng của nó).
const SIGNS_BEFORE = JSON.parse(LIVE.signs.value)
if (JSON.stringify(SIGNS_BEFORE) !== LIVE.signs.value) throw new Error('Dòng dấu hiệu không phải JSON gọn')
if (SIGNS_BEFORE.some(s => CODES.some(c => c.code === s.code))) throw new Error('Đã có dấu hiệu cho mã FB19')
const ACTION_CODES = ACTIONS.map(a => a.code)
const NEW_SIGNS = [
  { code: NOT_ON_MESSENGER.code, source: 'message', actions: ACTION_CODES, phases: [], replaces: [], texts: [NOT_ON_MESSENGER_MESSAGE] },
  { code: FB19.code, source: 'message', actions: ACTION_CODES, phases: [], replaces: [], texts: [FRIENDS_ONLY_MESSAGE] }
]
const SIGNS_AFTER = [...SIGNS_BEFORE, ...NEW_SIGNS]
const SIGNS_AFTER_JSON = JSON.stringify(SIGNS_AFTER)
const SIGNS_AFTER_MD5 = md5(SIGNS_AFTER_JSON)

const POLICY_COLUMNS = ['error_code', 'action_code', 'campaign_action_id', 'detail_status_id', 'detail_mode', 'log_template', 'campaign_note_template',
  'quota_effect', 'target_streak_effect', 'streak_threshold', 'target_effect', 'remaining_steps', 'lock_action_codes', 'lock_mode', 'run_effect',
  'pace_mode', 'campaign_effect', 'account_effect', 'login_effect', 'description', 'source']
// Khai đủ mọi cột hành vi để chính sách gộp không lấy trường nào từ dòng chung của mã / lớp lỗi. Như FB26 hộp thư Page (V591), riêng bước còn lại
// giữ "continue" như FB42 hôm nay (nhắn theo UID có thể còn bước kết bạn sau).
const POLICIES = CODES.flatMap(c => ACTIONS.map(a => ({
  error_code: c.code, action_code: a.code, detail_status_id: 21, detail_mode: 'write', log_template: c.title, campaign_note_template: note(c),
  quota_effect: 'no_count', target_streak_effect: 'ignore', target_effect: 'complete', remaining_steps: 'continue', run_effect: 'continue',
  pace_mode: 'full', campaign_effect: 'none', account_effect: 'none', login_effect: 'none',
  description: `[anh chốt 20/11] ${c.pub} ${a.code === 'fb_message_friend' ? 'nhắn tin bạn bè' : 'nhắn tin theo UID'}: Facebook ghi "${c === FB19
    ? 'Bạn không thể nhắn tin cho tài khoản này' : 'chưa thể truy cập vào đoạn chat này'}"; như FB26 hộp thư Page: đóng data, ghi thất bại, không tính lượt, không cộng chuỗi, chạy tiếp.`,
  lock_action_codes: [], lock_mode: 'fixed_minutes', source: SOURCE
})))
const policyValues = POLICIES.map(p => `  (${POLICY_COLUMNS.map(col => {
  const v = p[col]
  if (v === undefined || v === null) return 'NULL'
  if (Array.isArray(v)) return `ARRAY[${v.map(lit).join(', ')}]::text[]`
  return typeof v === 'number' ? String(v) : lit(v)
}).join(', ')})`).join(',\n')

// Kết quả phải ra sau khi apply (chính sách gộp ở hai thao tác, mọi pha; FB42 giữ nguyên).
const PHASES = ['before_send', 'in_flight', 'after_send']
const EXPECT = [
  ...CODES.map(c => [c.code, { target_effect: 'complete', target_streak_effect: 'ignore', campaign_effect: 'none', quota_effect: 'no_count',
    detail_status_id: '21', detail_mode: 'write', run_effect: 'continue', remaining_steps: 'continue', log_template: c.title,
    campaign_note_template: note(c), streak_threshold: null }]),
  [FB42.code, { target_effect: 'complete', target_streak_effect: 'increment', campaign_effect: 'none', quota_effect: 'count', detail_status_id: '21',
    log_template: '{message}' }]
]
const policyChecks = EXPECT.flatMap(([code, fields]) => ACTIONS.flatMap(a => PHASES.map(phase => `
  v_p := public.aka_agent_engine_resolve_policy(${lit(code)}, NULL, ${lit(a.code)}, ${lit(a.campaignAction)}, 'desktop', ${lit(phase)});
  IF ${Object.entries(fields).map(([k, v]) => `v_p->>${lit(k)} IS DISTINCT FROM ${v === null ? 'NULL' : lit(v)}`).join('\n     OR ')} THEN
    RAISE EXCEPTION 'V603 postflight: chính sách % % (%) ra %', ${lit(code)}, ${lit(a.code)}, ${lit(phase)}, v_p;
  END IF;`))).join('')

// Tín hiệu đúng dạng Desktop gửi: khi dấu hiệu khớp (kind block, mã của dấu hiệu); không khớp thì như hôm nay (dòng "thất bại" không mã → FB42).
const CLASSIFY = [
  [NOT_ON_MESSENGER.code, { kind: 'block', code: NOT_ON_MESSENGER.code, errorCode: NOT_ON_MESSENGER.code, message: `Lỗi nhắn tin đến A: ${NOT_ON_MESSENGER_MESSAGE}` }],
  [FB19.code, { kind: 'block', code: FB19.code, errorCode: FB19.code, message: `Lỗi nhắn tin đến A: ${FRIENDS_ONLY_MESSAGE}` }],
  [FB42.code, { kind: 'block', code: 'status:campaign_detail_failed', message: 'Lỗi nhắn tin đến A: waitForSelector timeout: [role="textbox"][contenteditable="true"]' }]
]
const classifyChecks = CLASSIFY.flatMap(([code, signal]) => ACTIONS.map(a => `
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', ${lit(a.code)}, 'before_send',
    ${lit(JSON.stringify(signal))}::jsonb) c;
  IF v_text IS DISTINCT FROM ${lit(code)} THEN RAISE EXCEPTION 'V603 postflight: tín hiệu % ở % ra %', ${lit(code)}, ${lit(a.code)}, v_text; END IF;`)).join('')

// Mã + câu + chính sách (dùng chung cho migration và bài kiểm qua bộ lập lịch Desktop thật, desktop-fb-smoke.cjs).
const CODES_POLICIES_SQL = `-- FB19: chỉ câu cho khách của engine (bộ cũ đọc noti_*, giữ nguyên); mã nội bộ thứ hai cùng FB19 (như Z221 có nhiều mã nội bộ).
UPDATE public.auto_error SET customer_title = ${lit(FB19.title)}, updated_at = now()
 WHERE error_code = ${lit(FB19.code)} AND customer_title = ${lit(FB19.oldTitle)};

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', ${lit(NOT_ON_MESSENGER.code)}, ${lit(NOT_ON_MESSENGER.title)}, ${lit(`V603 (engine v2): ${NOT_ON_MESSENGER.title}`)}, NULL, NULL, '{}',
  false, false, 'fixed_minutes', '{}', '{}', true, false, ${lit(NOT_ON_MESSENGER.pub)}, ${lit(NOT_ON_MESSENGER.cls)}, ${lit(NOT_ON_MESSENGER.title)}, NULL);

INSERT INTO public.auto_outcome_policies (${POLICY_COLUMNS.join(', ')}) VALUES
${policyValues};`

const elementValues = ELEMENTS.map(e => `  (${lit(e.name)}, ${lit(e.xpath)}, ${lit(e.description)}, 'facebook', true, NULL, NULL)`).join(',\n')
const elementNames = ELEMENTS.map(e => lit(e.name)).join(', ')
const stepIds = ACTIONS.map(a => a.stepId).join(', ')

const migration = `-- ${NAME}: nhắn tin bạn bè / theo UID không thấy ô nhập tin Messenger mà Facebook ghi lý do ở chỗ đó → FB19. Câu 570 của hộp thư lỗi,
-- anh chốt 20/11/2026 (docs/ENGINE_V2_FACEBOOK_MESSENGER_SIGNS_V603.md). Sinh bằng scripts/build-v603-sql.cjs (nguồn kiểm
-- scripts/fixtures/engine-v2-facebook/v603-live-20261120.json), không sửa tay. Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST).
--   * Hai element mới ở auto_elements (${ELEMENTS.map(e => e.name).join(', ')}), sửa XPath ở màn Element khi Facebook đổi chữ.
--   * Bản "[engine]" của block gửi tin Messenger (${BLOCK.id}; bộ cũ ${BLOCK.sourceId} không đổi): hết giờ chờ ô nhập tin thì dò hai câu đó, thấy thì báo câu riêng.
--     Danh mục bước ${stepIds} (nhắn tin bạn bè, theo UID) ghi md5 mới.
--   * Hai dấu hiệu "message" ở facebook.error_signs đổi câu đó ra FB19 cho nhắn tin bạn bè và theo UID.
--   * FB19 có hai mã nội bộ: ${FB19.code} (mã có sẵn, chưa chỗ nào phát) "${FB19.title}";
--     ${NOT_ON_MESSENGER.code} mới "${NOT_ON_MESSENGER.title}".
--   * Chính sách hai thao tác: như FB26 hộp thư Page (đóng data, ghi thất bại, không tính lượt, không cộng chuỗi, chạy tiếp).
-- Không thấy hai câu (gồm đoạn chat cũ trước mã hoá đầu cuối có nút "Tiếp tục": anh chờ DOM) thì vẫn FB42 như hôm nay. Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v603_%') THEN
      RAISE EXCEPTION 'V603: sổ migration đã có migration_v603_%%, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND name = ${lit(BLOCK.name)} AND md5(code) = '${BLOCK.oldMd5}') THEN
    RAISE EXCEPTION 'V603: block ${BLOCK.id} khác bản đã đọc (md5 ${BLOCK.oldMd5}), đọc lại và sinh lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = ${BLOCK.id} AND source_block_id = ${BLOCK.sourceId}) THEN
    RAISE EXCEPTION 'V603: thiếu sổ chép block ${BLOCK.id}';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id};
  IF v_n <> ${ACTIONS.length} THEN RAISE EXCEPTION 'V603: block ${BLOCK.id} có % dòng danh mục bước, cần ${ACTIONS.length}', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps
   WHERE block_id = ${BLOCK.id} AND (id, action_code) IN (${ACTIONS.map(a => `(${a.stepId}, ${lit(a.code)})`).join(', ')})
     AND commit_level = ${STEP.commitLevel} AND send_ops = '${JSON.stringify(STEP.sendOps)}'::jsonb AND reviewed_code_md5 = '${BLOCK.oldMd5}';
  IF v_n <> ${ACTIONS.length} THEN RAISE EXCEPTION 'V603: dòng danh mục bước ${stepIds} khác bản đã đọc'; END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '${SIGNS_BEFORE_MD5}' THEN
    RAISE EXCEPTION 'V603: dòng facebook.error_signs đã đổi';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_elements WHERE name IN (${elementNames})) THEN
    RAISE EXCEPTION 'V603: đã có element mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(FB19.code)} AND public_code = 'FB19' AND is_active AND NOT is_delete
                   AND customer_title = ${lit(FB19.oldTitle)} AND customer_help IS NULL AND error_class = 'target_permanent') THEN
    RAISE EXCEPTION 'V603: mã FB19 khác bản đã đọc';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(FB42.code)} AND public_code = 'FB42' AND is_active AND NOT is_delete) THEN
    RAISE EXCEPTION 'V603: thiếu mã FB42';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(NOT_ON_MESSENGER.code)}) THEN
    RAISE EXCEPTION 'V603: đã có mã ${NOT_ON_MESSENGER.code}';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = ${lit(SOURCE)})
     OR EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code IN (${CODES.map(c => lit(c.code)).join(', ')})
                  AND action_code IN (${ACTION_CODES.map(lit).join(', ')}) AND is_active AND NOT is_delete) THEN
    RAISE EXCEPTION 'V603: đã có chính sách FB19 ở nhắn tin hoặc dòng nguồn ${SOURCE}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_status WHERE id = 21 AND code = 'campaign_detail_failed' AND status_value = 'thất bại') THEN
    RAISE EXCEPTION 'V603: trạng thái 21 không phải "thất bại"';
  END IF;
END $pre$;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id) VALUES
${elementValues};

${EDITS.map(e => `UPDATE public.auto_blocks SET code = replace(code, ${dq(e.from)}, ${dq(e.to)}), updated_at = now()
 WHERE id = ${BLOCK.id} AND strpos(code, ${dq(e.to)}) = 0;`).join('\n')}
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${NEW_MD5}', updated_at = now()
 WHERE id IN (${stepIds}) AND block_id = ${BLOCK.id} AND reviewed_code_md5 = '${BLOCK.oldMd5}';

UPDATE public.auto_system_settings SET value = ${lit(SIGNS_AFTER_JSON)}, updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = '${SIGNS_BEFORE_MD5}';

${CODES_POLICIES_SQL}

DO $post$
DECLARE v_p jsonb; v_text text; v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V603 postflight: code block ${BLOCK.id} không ra đúng bản mong đợi (md5 ${NEW_MD5})';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id} AND reviewed_code_md5 IS DISTINCT FROM '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V603 postflight: danh mục bước của block ${BLOCK.id} chưa ghi md5 mới';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '${SIGNS_AFTER_MD5}' THEN
    RAISE EXCEPTION 'V603 postflight: dòng facebook.error_signs';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_elements WHERE (name, xpath) IN (${ELEMENTS.map(e => `(${lit(e.name)}, ${lit(e.xpath)})`).join(', ')});
  IF v_n <> ${ELEMENTS.length} THEN RAISE EXCEPTION 'V603 postflight: % element mới', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE source = ${lit(SOURCE)} AND is_active AND NOT is_delete;
  IF v_n <> ${POLICIES.length} THEN RAISE EXCEPTION 'V603 postflight: % dòng chính sách mới', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(FB19.code)} AND customer_title = ${lit(FB19.title)} AND customer_help IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(NOT_ON_MESSENGER.code)} AND public_code = 'FB19' AND is_active
                      AND customer_title = ${lit(NOT_ON_MESSENGER.title)} AND customer_help IS NULL) THEN
    RAISE EXCEPTION 'V603 postflight: câu FB19';
  END IF;
${policyChecks}
${classifyChecks}
END $post$;

COMMIT;
`

const rollback = `-- Gỡ ${NAME}: trả block ${BLOCK.id}, danh mục bước ${stepIds}, dòng facebook.error_signs và câu FB19 về bản trước V603; tắt mã
-- ${NOT_ON_MESSENGER.code} và ${POLICIES.length} dòng chính sách nguồn ${SOURCE} (không xoá: auto_engine_outcomes có thể đã giữ mã); xoá hai element
-- mới sau khi block không còn đọc. Chỉ chạy khi block đang đúng bản V603 (đã ai sửa sau V603 thì dừng, không ghi đè). Sinh bằng scripts/build-v603-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V603: block ${BLOCK.id} khác bản V603 (md5 ${NEW_MD5})';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '${SIGNS_AFTER_MD5}' THEN
    RAISE EXCEPTION 'Gỡ V603: dòng facebook.error_signs khác bản V603';
  END IF;
END $pre$;

${[...EDITS].reverse().map(e => `UPDATE public.auto_blocks SET code = replace(code, ${dq(e.to)}, ${dq(e.from)}), updated_at = now()
 WHERE id = ${BLOCK.id};`).join('\n')}
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${BLOCK.oldMd5}', updated_at = now()
 WHERE id IN (${stepIds}) AND block_id = ${BLOCK.id} AND reviewed_code_md5 = '${NEW_MD5}';
UPDATE public.auto_system_settings SET value = ${lit(LIVE.signs.value)}, updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = '${SIGNS_AFTER_MD5}';
UPDATE public.auto_outcome_policies SET is_active = false WHERE source = ${lit(SOURCE)} AND is_active;
UPDATE public.auto_error SET is_active = false, updated_at = now() WHERE error_code = ${lit(NOT_ON_MESSENGER.code)};
UPDATE public.auto_error SET customer_title = ${lit(FB19.oldTitle)}, updated_at = now()
 WHERE error_code = ${lit(FB19.code)} AND customer_title = ${lit(FB19.title)};
DELETE FROM public.auto_elements WHERE name IN (${elementNames});

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${BLOCK.oldMd5}')
     OR EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id} AND reviewed_code_md5 IS DISTINCT FROM '${BLOCK.oldMd5}')
     OR (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '${SIGNS_BEFORE_MD5}'
     OR EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = ${lit(SOURCE)} AND is_active)
     OR EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(NOT_ON_MESSENGER.code)} AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(FB19.code)} AND customer_title = ${lit(FB19.oldTitle)})
     OR EXISTS (SELECT 1 FROM public.auto_elements WHERE name IN (${elementNames})) THEN
    RAISE EXCEPTION 'Gỡ V603: dữ liệu chưa về bản trước V603';
  END IF;
END $post$;

COMMIT;
`

const outputs = [[`migrations/${NAME}.sql`, migration], [`migrations/${ROLLBACK_NAME}.sql`, rollback]]
if (require.main === module) {
  const check = process.argv.includes('--check')
  for (const [file, sql] of outputs) {
    const target = path.join(ROOT, file)
    if (check) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== sql) throw new Error(`${file} lệch bộ sinh, chạy lại bộ sinh`)
    } else {
      fs.writeFileSync(target, sql)
    }
    console.log(`${check ? 'khớp' : 'đã ghi'} ${file} (md5 ${md5(sql)})`)
  }
  console.log(`block ${BLOCK.id}: ${BLOCK.oldMd5} -> ${NEW_MD5}; dấu hiệu ${SIGNS_BEFORE_MD5} -> ${SIGNS_AFTER_MD5}`)
}

module.exports = { NAME, ROLLBACK_NAME, SOURCE, ACTIONS, ACTION_CODES, BLOCK, STEP, FB19, FB42, NOT_ON_MESSENGER, CODES, ELEMENTS, EDITS, NEW_CODE, NEW_MD5,
  SIGNS_BEFORE_MD5, SIGNS_AFTER_JSON, SIGNS_AFTER_MD5, NEW_SIGNS, POLICIES, NOT_ON_MESSENGER_MESSAGE, FRIENDS_ONLY_MESSAGE, PHASES, LIVE,
  CODES_POLICIES_SQL, migration, rollback, note }
