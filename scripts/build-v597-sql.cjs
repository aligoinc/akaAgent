#!/usr/bin/env node
// Sinh migration V597 (anh chốt 20/11/2026, câu 585 của hộp thư lỗi; docs/ENGINE_V2_FACEBOOK_GROUP_POST_SIGNS_V597.md): đăng nhóm hết giờ chờ mà
// hộp "Tạo bài viết" chưa đóng (FB42 "Form đăng bài chưa đóng sau 60 giây") thì nhận ba trường hợp Facebook tự ghi lý do bằng chữ đỏ trong hộp
// (đọc ảnh lỗi yêu cầu 3, 6, 8 ngày 20/11):
//   * "Chúng tôi gặp sự cố khi hoàn tất yêu cầu của bạn…" → FB48 mới, xử lý như FB42 hôm nay (ghi thất bại, tính lượt, cộng chuỗi, data đóng).
//   * "Không thể tải file của bạn lên: <tệp>" (nút Đăng xám) → FB49 mới: ghi thất bại, không tính lượt, cộng chuỗi, data về hàng đợi.
//   * "Vì lý do bảo mật, tài khoản của bạn đã giới hạn quyền truy cập…" → FB50 mới: ghi thất bại, tạm dừng chiến dịch ngay, data về hàng đợi,
//     không tính lượt, không cộng chuỗi.
// Không thấy chữ nào thì vẫn FB42 như cũ. Vòng quay "Đang đăng" (FB30) chưa làm: anh chốt chờ DOM. Chỉ dữ liệu (không DDL, không nạp lại schema
// PostgREST), chỉ bản "[engine]" của block (bộ cũ 2624 không đổi), không cần phát hành app (Desktop ≥ 9.9.0 đã có dấu hiệu theo câu block và tự
// nạp lại element khi gặp tên mới).
//   node scripts/build-v597-sql.cjs            ghi migration + bản gỡ
//   node scripts/build-v597-sql.cjs --check    chỉ kiểm file đang có khớp bộ sinh
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const NAME = 'migration_v597_engine_facebook_group_post_signs'
const ROLLBACK_NAME = 'rollback_v597_engine_facebook_group_post_signs'
const SOURCE = 'v597'
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const lit = text => text == null ? 'NULL' : `'${String(text).replace(/'/g, "''")}'`
const LIVE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/engine-v2-facebook/v597-live-20261120.json'), 'utf8'))

const ACTION = 'fb_post_group'
const CAMPAIGN_ACTION = 'facebook_group_post'
const BLOCK = { id: 2871, name: '[engine] fb_verify_group_post_form_closed', sourceId: 2624, oldMd5: 'e433ac1a58ac08535c53010fdc5e9ba7' }
const STEP = { id: 4, commitLevel: 1, sendOps: [] }
const SIGNS_BEFORE_MD5 = 'aa197aea7d2dc397545a8f8e5a8a5a5c'
if (LIVE.block.id !== BLOCK.id || LIVE.block.name !== BLOCK.name || md5(LIVE.block.code) !== BLOCK.oldMd5) throw new Error('Fixture block 2871 lệch')
if (LIVE.sourceBlock.id !== BLOCK.sourceId || LIVE.sourceBlock.md5 !== BLOCK.oldMd5) throw new Error('Fixture block bộ cũ 2624 lệch')
if (LIVE.copy.source_block_id !== BLOCK.sourceId || LIVE.copy.engine_block_id !== BLOCK.id || LIVE.step.id !== STEP.id
  || LIVE.step.block_id !== BLOCK.id || LIVE.step.reviewed_code_md5 !== BLOCK.oldMd5 || LIVE.step.commit_level !== STEP.commitLevel
  || JSON.stringify(LIVE.step.send_ops) !== '[]') throw new Error('Fixture danh mục bước / sổ chép lệch')
if (md5(LIVE.signs.value) !== SIGNS_BEFORE_MD5 || LIVE.signs.md5 !== SIGNS_BEFORE_MD5) throw new Error('Fixture dấu hiệu lệch')
if (LIVE.maxFb !== 47) throw new Error(`Fixture: mã FB lớn nhất là FB${LIVE.maxFb}, cần FB47`)

// Mã và câu anh duyệt qua hộp chọn 20/11/2026 (FB50: anh bỏ đoạn "khi Facebook gỡ giới hạn, bấm Tiếp tục chiến dịch", không có bước tiếp theo).
const FB42 = { code: 'err_engine_fb_action_failed', pub: 'FB42' }
const FB48 = { code: 'err_fb_group_post_request_failed', pub: 'FB48', cls: 'target_permanent', title: 'Facebook báo gặp sự cố khi đăng bài', help: null,
  scope: 'Đăng nhóm: hộp Tạo bài viết chưa đóng và Facebook ghi "Chúng tôi gặp sự cố khi hoàn tất yêu cầu của bạn".' }
const FB49 = { code: 'err_fb_group_post_upload_failed', pub: 'FB49', cls: 'transient', title: 'Facebook không tải được ảnh hoặc video lên', help: null,
  scope: 'Đăng nhóm: hộp Tạo bài viết chưa đóng và Facebook ghi "Không thể tải file của bạn lên".' }
const FB50 = { code: 'err_fb_account_access_limited', pub: 'FB50', cls: 'account_restricted', title: 'Facebook đang giới hạn quyền truy cập của tài khoản',
  help: null, scope: 'Đăng nhóm: hộp Tạo bài viết chưa đóng và Facebook ghi "Vì lý do bảo mật, tài khoản của bạn đã giới hạn quyền truy cập".' }
const NEW_CODES = [FB48, FB49, FB50]
if (LIVE.errors.FB42.error_code !== FB42.code || LIVE.errors.FB42.error_class !== FB48.cls) throw new Error('Fixture FB42 lệch')
const note = c => c.help ? `${c.title} (${c.pub}). ${c.help}` : `${c.title} (${c.pub}).`

// Element theo chữ đỏ Facebook ghi trong hộp Tạo bài viết (ảnh lỗi 20/11; chưa có DOM nên so một đoạn chữ, không theo cấu trúc). Chỉ trong hộp
// thoại / form, bỏ phần nội dung bài khách gõ (contenteditable) để chữ trong bài không bị nhận nhầm. Sửa ở màn Element khi Facebook đổi chữ; thêm
// bản tiếng Anh bằng `|` khi có mẫu.
const scoped = text => `//*[@role='dialog' or self::form]//text()[contains(., '${text}')][not(ancestor::*[@contenteditable='true'])]/..`
const ELEMENTS = [
  { name: 'GroupPostRequestFailedNotice', xpath: scoped('gặp sự cố khi hoàn tất yêu cầu'),
    description: 'V597: chữ đỏ Facebook ghi trong hộp Tạo bài viết khi không hoàn tất được yêu cầu đăng bài (FB48). Thêm bản tiếng Anh bằng | khi có mẫu.' },
  { name: 'GroupPostUploadFailedNotice', xpath: scoped('Không thể tải file của bạn lên'),
    description: 'V597: chữ đỏ Facebook ghi trong hộp Tạo bài viết khi không tải được tệp của bài lên (FB49). Thêm bản tiếng Anh bằng | khi có mẫu.' },
  { name: 'GroupPostAccountAccessLimitedNotice', xpath: scoped('tài khoản của bạn đã giới hạn quyền truy cập'),
    description: 'V597: chữ đỏ Facebook ghi trong hộp Tạo bài viết khi tài khoản bị giới hạn quyền truy cập vì lý do bảo mật (FB50). Thêm bản tiếng Anh bằng | khi có mẫu.' }
]
for (const e of ELEMENTS) if (LIVE.elements.some(x => x.name === e.name)) throw new Error(`Element ${e.name} đã có`)

// Câu block trả (cũng là chữ của dấu hiệu "message": dòng lịch sử "Đăng bài thất bại vào <nhóm>: <câu>" chứa câu này).
const EDITS = [
  {
    from: "const frequencyLimitError = await helpers.element('GroupPostFrequencyLimitError');\n",
    to: "const frequencyLimitError = await helpers.element('GroupPostFrequencyLimitError');\n" +
      `const requestFailedNotice = await helpers.element('${ELEMENTS[0].name}');\n` +
      `const uploadFailedNotice = await helpers.element('${ELEMENTS[1].name}');\n` +
      `const accountAccessLimitedNotice = await helpers.element('${ELEMENTS[2].name}');\n`
  },
  {
    from: "  message = 'Form đăng bài chưa đóng sau ' + (publishTimeoutMs / 1000) + ' giây';\n}\n",
    to: [
      '  // V597: Facebook ghi lý do bằng chữ đỏ trong hộp Tạo bài viết. Nhận theo chữ có mặt (element ở auto_elements), không thấy thì như cũ.',
      '  if (await hasVisibleElement(accountAccessLimitedNotice)) {',
      `    message = '${FB50.title}';`,
      '  } else if (await hasVisibleElement(uploadFailedNotice)) {',
      `    message = '${FB49.title}';`,
      '  } else if (await hasVisibleElement(requestFailedNotice)) {',
      `    message = '${FB48.title}';`,
      '  } else {',
      "    message = 'Form đăng bài chưa đóng sau ' + (publishTimeoutMs / 1000) + ' giây';",
      '  }',
      '}',
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
const Q = '$v597$'
for (const text of [LIVE.block.code, NEW_CODE, ...EDITS.flatMap(e => [e.from, e.to])]) if (text.includes(Q)) throw new Error('Code chứa dấu nháy $v597$')
const dq = text => `${Q}${text}${Q}`

// Ba dấu hiệu "message" thêm vào cuối dòng (dòng lịch sử đăng nhóm không mã: replaces rỗng; chữ không trùng dấu hiệu nào đang có).
const SIGNS_BEFORE = JSON.parse(LIVE.signs.value)
if (JSON.stringify(SIGNS_BEFORE) !== LIVE.signs.value) throw new Error('Dòng dấu hiệu không phải JSON gọn')
const NEW_SIGNS = NEW_CODES.map(c => ({ code: c.code, source: 'message', actions: [ACTION], phases: [], replaces: [], texts: [c.title] }))
for (const s of SIGNS_BEFORE) {
  if (NEW_CODES.some(c => c.code === s.code)) throw new Error(`Đã có dấu hiệu ${s.code}`)
  for (const t of s.texts) if (NEW_CODES.some(c => c.title.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(c.title.toLowerCase()))) {
    throw new Error(`Chữ dấu hiệu ${s.code} trùng câu mới`)
  }
}
const SIGNS_AFTER = [...SIGNS_BEFORE, ...NEW_SIGNS]
const SIGNS_AFTER_JSON = JSON.stringify(SIGNS_AFTER)
const SIGNS_AFTER_MD5 = md5(SIGNS_AFTER_JSON)

const POLICY_COLUMNS = ['error_code', 'action_code', 'campaign_action_id', 'detail_status_id', 'detail_mode', 'log_template', 'campaign_note_template',
  'quota_effect', 'target_streak_effect', 'streak_threshold', 'target_effect', 'remaining_steps', 'lock_action_codes', 'lock_mode', 'run_effect',
  'pace_mode', 'campaign_effect', 'account_effect', 'login_effect', 'description', 'source']
// Khai đủ mọi cột hành vi để chính sách gộp không lấy trường nào từ dòng chung của mã / lớp lỗi. FB48 lấy đúng chính sách gộp của FB42 ở đăng
// nhóm hôm nay (fixture `resolved.FB42`, cột nào không có trong đó là NULL).
const R42 = LIVE.resolved.FB42.after_send
for (const ph of ['before_send', 'in_flight']) if (JSON.stringify(LIVE.resolved.FB42[ph]) !== JSON.stringify(R42)) throw new Error('FB42 khác nhau theo pha')
if (R42.detail_status_id !== 21 || R42.target_effect !== 'complete' || R42.target_streak_effect !== 'increment' || R42.quota_effect !== 'count'
  || R42.campaign_effect !== 'none' || R42.log_template !== '{message}') throw new Error('Chính sách gộp FB42 ở đăng nhóm khác bản đã đọc 20/11')
const POLICIES = [
  { error_code: FB48.code, detail_status_id: R42.detail_status_id, detail_mode: R42.detail_mode, log_template: R42.log_template,
    campaign_note_template: R42.campaign_note_template ?? null, quota_effect: R42.quota_effect, target_streak_effect: R42.target_streak_effect,
    streak_threshold: R42.streak_threshold ?? null, target_effect: R42.target_effect, remaining_steps: R42.remaining_steps, run_effect: R42.run_effect,
    pace_mode: R42.pace_mode, campaign_effect: R42.campaign_effect, account_effect: R42.account_effect, login_effect: R42.login_effect,
    description: '[anh chốt 20/11, câu 585] FB48 đăng nhóm: Facebook ghi gặp sự cố khi hoàn tất yêu cầu; xử lý như FB42 hôm nay (ghi thất bại, tính lượt, cộng chuỗi, data đóng).' },
  { error_code: FB49.code, detail_status_id: 21, detail_mode: 'write', log_template: '{message}', campaign_note_template: null,
    quota_effect: 'no_count', target_streak_effect: 'increment', target_effect: 'requeue', remaining_steps: 'skip', run_effect: 'continue',
    pace_mode: 'full', campaign_effect: 'none', account_effect: 'none', login_effect: 'none',
    description: '[anh chốt 20/11, câu 585] FB49 đăng nhóm: Facebook không tải được tệp lên (nút Đăng xám, bài chưa gửi); ghi thất bại, không tính lượt, cộng chuỗi, data về hàng đợi.' },
  { error_code: FB50.code, detail_status_id: 21, detail_mode: 'write', log_template: '{message}', campaign_note_template: note(FB50),
    quota_effect: 'no_count', target_streak_effect: 'ignore', target_effect: 'requeue', remaining_steps: 'skip', run_effect: 'end_unit',
    pace_mode: 'none', campaign_effect: 'pause', account_effect: 'none', login_effect: 'none',
    description: '[anh chốt 20/11, câu 585] FB50 đăng nhóm: Facebook giới hạn quyền truy cập của tài khoản; ghi thất bại, tạm dừng chiến dịch ngay, data về hàng đợi, không tính lượt, không cộng chuỗi.' }
].map(p => ({ ...p, action_code: ACTION, campaign_action_id: null, lock_action_codes: [], lock_mode: 'fixed_minutes', source: SOURCE }))
const policyValues = POLICIES.map(p => `  (${POLICY_COLUMNS.map(col => {
  const v = p[col]
  if (v === undefined || v === null) return 'NULL'
  if (Array.isArray(v)) return `ARRAY[${v.map(lit).join(', ')}]::text[]`
  return typeof v === 'number' ? String(v) : lit(v)
}).join(', ')})`).join(',\n')

// Kết quả phải ra sau khi apply (chính sách gộp ở đăng nhóm, mọi pha). FB48 = FB42 từng trường trừ lớp lỗi (cùng lớp target_permanent).
const PHASES = ['before_send', 'in_flight', 'after_send']
const EXPECT = [
  [FB49.code, { target_effect: 'requeue', target_streak_effect: 'increment', campaign_effect: 'none', quota_effect: 'no_count', detail_status_id: '21',
    detail_mode: 'write', run_effect: 'continue', remaining_steps: 'skip', log_template: '{message}', streak_threshold: null, error_class: FB49.cls }],
  [FB50.code, { target_effect: 'requeue', target_streak_effect: 'ignore', campaign_effect: 'pause', quota_effect: 'no_count', detail_status_id: '21',
    detail_mode: 'write', run_effect: 'end_unit', remaining_steps: 'skip', log_template: '{message}', campaign_note_template: note(FB50),
    streak_threshold: null, error_class: FB50.cls }]
]
const resolveSql = (code, phase) =>
  `public.aka_agent_engine_resolve_policy(${lit(code)}, NULL, ${lit(ACTION)}, ${lit(CAMPAIGN_ACTION)}, 'desktop', ${lit(phase)}) - 'policy_ids' - 'revisions'`
const policyChecks = [
  ...PHASES.map(phase => `
  IF (${resolveSql(FB48.code, phase)}) IS DISTINCT FROM (${resolveSql(FB42.code, phase)}) THEN
    RAISE EXCEPTION 'V597 postflight: chính sách FB48 (%) khác FB42: % / %', ${lit(phase)}, ${resolveSql(FB48.code, phase)}, ${resolveSql(FB42.code, phase)};
  END IF;`),
  ...EXPECT.flatMap(([code, fields]) => PHASES.map(phase => `
  v_p := ${resolveSql(code, phase)};
  IF ${Object.entries(fields).map(([k, v]) => `v_p->>${lit(k)} IS DISTINCT FROM ${v === null ? 'NULL' : lit(v)}`).join('\n     OR ')} THEN
    RAISE EXCEPTION 'V597 postflight: chính sách % (%) ra %', ${lit(code)}, ${lit(phase)}, v_p;
  END IF;`))
].join('')

// Tín hiệu đúng dạng Desktop gửi khi dấu hiệu khớp (milestoneOutcomes.ts: dòng "thất bại" không mã, pha after_send; dấu hiệu đổi thành mã).
const rowMessage = text => `Đăng bài thất bại vào Nhóm A: ${text}`
const CLASSIFY = [
  ...NEW_CODES.map(c => [c.code, { kind: 'block', code: c.code, errorCode: c.code, message: rowMessage(c.title) }]),
  [FB42.code, { kind: 'block', code: 'status:campaign_detail_failed', message: rowMessage('Form đăng bài chưa đóng sau 60 giây') }]
]
const classifyChecks = CLASSIFY.map(([code, signal]) => `
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', ${lit(ACTION)}, 'after_send', ${lit(JSON.stringify(signal))}::jsonb) c;
  IF v_text IS DISTINCT FROM ${lit(code)} THEN RAISE EXCEPTION 'V597 postflight: tín hiệu % ra %', ${lit(code)}, v_text; END IF;`).join('')

const elementValues = ELEMENTS.map(e => `  (${lit(e.name)}, ${lit(e.xpath)}, ${lit(e.description)}, 'facebook', true, NULL, NULL)`).join(',\n')
const elementNames = ELEMENTS.map(e => lit(e.name)).join(', ')
const newCodeList = NEW_CODES.map(c => lit(c.code)).join(', ')
const newPubList = NEW_CODES.map(c => lit(c.pub)).join(', ')
const errorValues = NEW_CODES.map(c => `  ('engine v2', ${lit(c.code)}, ${lit(c.title)}, ${lit(`V597 (engine v2): ${c.scope}`)}, NULL, NULL, '{}', false, false, 'fixed_minutes',
   '{}', '{}', true, false, ${lit(c.pub)}, ${lit(c.cls)}, ${lit(c.title)}, ${lit(c.help)})`).join(',\n')

// Riêng phần mã + chính sách (đúng câu trong migration), cho DB thử của bộ kiểm Desktop (desktop-fb-smoke.cjs) không có block 2871 / dòng dấu
// hiệu như production; dấu hiệu nạp thẳng như Desktop đọc.
const CODES_POLICIES_SQL = `INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES
${errorValues};

INSERT INTO public.auto_outcome_policies (${POLICY_COLUMNS.join(', ')}) VALUES
${policyValues};
`

const migration = `-- ${NAME}: đăng nhóm hết giờ chờ mà hộp Tạo bài viết chưa đóng (FB42 "Form đăng bài chưa đóng") thì nhận ba trường hợp Facebook ghi lý do bằng
-- chữ đỏ trong hộp. Anh chốt 20/11/2026 (câu 585 của hộp thư lỗi; docs/ENGINE_V2_FACEBOOK_GROUP_POST_SIGNS_V597.md). Sinh bằng
-- scripts/build-v597-sql.cjs (nguồn kiểm scripts/fixtures/engine-v2-facebook/v597-live-20261120.json), không sửa tay. Chỉ dữ liệu, không DDL
-- (không nạp lại schema PostgREST).
--   * Ba element mới ở auto_elements (${ELEMENTS.map(e => e.name).join(', ')}), sửa XPath ở màn Element khi Facebook đổi chữ.
--   * Bản "[engine]" của block chờ form đăng nhóm đóng (${BLOCK.id}; bộ cũ ${BLOCK.sourceId} không đổi): hết giờ thì dò ba chữ đó, thấy thì trả câu riêng.
--   * Ba dấu hiệu "message" ở facebook.error_signs đổi câu đó ra mã mới (dòng lịch sử đăng nhóm không mã).
--   * FB48 "${FB48.title}": như FB42 hôm nay (ghi thất bại, tính lượt, cộng chuỗi, data đóng).
--   * FB49 "${FB49.title}": ghi thất bại, không tính lượt, cộng chuỗi, data về hàng đợi.
--   * FB50 "${FB50.title}": ghi thất bại, tạm dừng chiến dịch ngay, data về hàng đợi, không tính lượt, không cộng chuỗi.
-- Không thấy chữ nào thì vẫn FB42. Vòng quay "Đang đăng" chưa làm (anh chốt chờ DOM). Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v597_%') THEN
      RAISE EXCEPTION 'V597: sổ migration đã có migration_v597_%%, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND name = ${lit(BLOCK.name)} AND md5(code) = '${BLOCK.oldMd5}') THEN
    RAISE EXCEPTION 'V597: block ${BLOCK.id} khác bản đã đọc (md5 ${BLOCK.oldMd5}), đọc lại và sinh lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = ${BLOCK.id} AND source_block_id = ${BLOCK.sourceId}) THEN
    RAISE EXCEPTION 'V597: thiếu sổ chép block ${BLOCK.id}';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id};
  IF v_n <> 1 THEN RAISE EXCEPTION 'V597: block ${BLOCK.id} có % dòng danh mục bước, cần 1', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND commit_level = ${STEP.commitLevel}
                   AND send_ops = '${JSON.stringify(STEP.sendOps)}'::jsonb AND reviewed_code_md5 = '${BLOCK.oldMd5}') THEN
    RAISE EXCEPTION 'V597: dòng danh mục bước ${STEP.id} khác bản đã đọc';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '${SIGNS_BEFORE_MD5}' THEN
    RAISE EXCEPTION 'V597: dòng facebook.error_signs đã đổi';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_elements WHERE name IN (${elementNames})) THEN
    RAISE EXCEPTION 'V597: đã có element mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_elements WHERE name = 'GroupPostFrequencyLimitError')
     OR NOT EXISTS (SELECT 1 FROM public.auto_elements WHERE name = 'GroupPostSubmitButtonAfterClick') THEN
    RAISE EXCEPTION 'V597: thiếu element block ${BLOCK.id} đang dùng';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(FB42.code)} AND public_code = 'FB42' AND is_active AND NOT is_delete
                   AND error_class = ${lit(FB48.cls)}) THEN
    RAISE EXCEPTION 'V597: mã FB42 khác bản đã đọc';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code IN (${newCodeList}) OR public_code IN (${newPubList})) THEN
    RAISE EXCEPTION 'V597: đã có mã FB48 / FB49 / FB50';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = ${lit(SOURCE)} OR error_code IN (${newCodeList})) THEN
    RAISE EXCEPTION 'V597: đã có chính sách nguồn ${SOURCE} hoặc của mã mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_status WHERE id = 21 AND code = 'campaign_detail_failed' AND status_value = 'thất bại') THEN
    RAISE EXCEPTION 'V597: trạng thái 21 không phải "thất bại"';
  END IF;
END $pre$;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id) VALUES
${elementValues};

${EDITS.map(e => `UPDATE public.auto_blocks SET code = replace(code, ${dq(e.from)}, ${dq(e.to)}), updated_at = now()
 WHERE id = ${BLOCK.id} AND strpos(code, ${dq(e.to)}) = 0;`).join('\n')}
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${NEW_MD5}', updated_at = now()
 WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND reviewed_code_md5 = '${BLOCK.oldMd5}';

UPDATE public.auto_system_settings SET value = ${lit(SIGNS_AFTER_JSON)}, updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = '${SIGNS_BEFORE_MD5}';

${CODES_POLICIES_SQL}
DO $post$
DECLARE v_p jsonb; v_text text; v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V597 postflight: code block ${BLOCK.id} không ra đúng bản mong đợi (md5 ${NEW_MD5})';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.sourceId} AND md5(code) = '${BLOCK.oldMd5}') THEN
    RAISE EXCEPTION 'V597 postflight: block bộ cũ ${BLOCK.sourceId} bị đổi';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id} AND reviewed_code_md5 IS DISTINCT FROM '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V597 postflight: danh mục bước của block ${BLOCK.id} chưa ghi md5 mới';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '${SIGNS_AFTER_MD5}' THEN
    RAISE EXCEPTION 'V597 postflight: dòng facebook.error_signs';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_elements WHERE (name, xpath) IN (${ELEMENTS.map(e => `(${lit(e.name)}, ${lit(e.xpath)})`).join(', ')});
  IF v_n <> ${ELEMENTS.length} THEN RAISE EXCEPTION 'V597 postflight: % element mới', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE source = ${lit(SOURCE)} AND is_active AND NOT is_delete;
  IF v_n <> ${POLICIES.length} THEN RAISE EXCEPTION 'V597 postflight: % dòng chính sách mới', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_error WHERE is_active AND NOT is_delete AND (error_code, public_code, error_class, customer_title) IN (
    ${NEW_CODES.map(c => `(${lit(c.code)}, ${lit(c.pub)}, ${lit(c.cls)}, ${lit(c.title)})`).join(',\n    ')}) AND customer_help IS NULL;
  IF v_n <> ${NEW_CODES.length} THEN RAISE EXCEPTION 'V597 postflight: % mã mới đúng câu', v_n; END IF;
${policyChecks}
${classifyChecks}
END $post$;

COMMIT;
`

const rollback = `-- Gỡ ${NAME}: trả block ${BLOCK.id}, danh mục bước ${STEP.id} và dòng facebook.error_signs về bản trước V597; tắt ba mã FB48 / FB49 / FB50 và ba
-- dòng chính sách nguồn ${SOURCE} (không xoá: auto_engine_outcomes có thể đã giữ mã); xoá ba element mới sau khi block không còn đọc. Chỉ chạy khi
-- block đang đúng bản V597 (đã ai sửa sau V597 thì dừng, không ghi đè). Sinh bằng scripts/build-v597-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V597: block ${BLOCK.id} khác bản V597 (md5 ${NEW_MD5})';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '${SIGNS_AFTER_MD5}' THEN
    RAISE EXCEPTION 'Gỡ V597: dòng facebook.error_signs khác bản V597';
  END IF;
END $pre$;

${[...EDITS].reverse().map(e => `UPDATE public.auto_blocks SET code = replace(code, ${dq(e.to)}, ${dq(e.from)}), updated_at = now()
 WHERE id = ${BLOCK.id};`).join('\n')}
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${BLOCK.oldMd5}', updated_at = now()
 WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND reviewed_code_md5 = '${NEW_MD5}';
UPDATE public.auto_system_settings SET value = ${lit(LIVE.signs.value)}, updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = '${SIGNS_AFTER_MD5}';
UPDATE public.auto_outcome_policies SET is_active = false WHERE source = ${lit(SOURCE)} AND is_active;
UPDATE public.auto_error SET is_active = false, updated_at = now() WHERE error_code IN (${newCodeList});
DELETE FROM public.auto_elements WHERE name IN (${elementNames});

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${BLOCK.oldMd5}')
     OR EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id} AND reviewed_code_md5 IS DISTINCT FROM '${BLOCK.oldMd5}')
     OR (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '${SIGNS_BEFORE_MD5}'
     OR EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = ${lit(SOURCE)} AND is_active)
     OR EXISTS (SELECT 1 FROM public.auto_error WHERE error_code IN (${newCodeList}) AND is_active)
     OR EXISTS (SELECT 1 FROM public.auto_elements WHERE name IN (${elementNames})) THEN
    RAISE EXCEPTION 'Gỡ V597: dữ liệu chưa về bản trước V597';
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

module.exports = { NAME, ROLLBACK_NAME, SOURCE, ACTION, CAMPAIGN_ACTION, BLOCK, STEP, FB42, FB48, FB49, FB50, NEW_CODES, ELEMENTS, EDITS, NEW_CODE,
  NEW_MD5, SIGNS_BEFORE_MD5, SIGNS_AFTER_JSON, SIGNS_AFTER_MD5, NEW_SIGNS, POLICIES, PHASES, LIVE, rowMessage, CODES_POLICIES_SQL, migration, rollback }
