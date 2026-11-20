#!/usr/bin/env node
// Sinh migration V591 (anh chốt 20/11/2026, docs/ENGINE_V2_FACEBOOK_PAGE_INBOX_V591.md): tách FB46 "không thấy ô nhập tin trong hộp thư
// Page" thành hai trường hợp Facebook tự ghi lý do ở chỗ ô nhập tin (đọc ảnh lỗi của tổ chức 441 và trang Page của anh):
//   * "Bạn không thể gửi tin nhắn cho người này nữa." → FB26 (mã có sẵn từ V346, chưa chỗ nào phát): đóng data, ghi lịch sử thất bại, không
//     tính lượt, không cộng chuỗi, chạy tiếp data sau.
//   * "Hãy xác nhận danh tính để gửi tin nhắn. …" → FB47 mới: đóng data (không trả về hàng đợi được: block đánh dấu "sắp gửi" trước khi chạy
//     nên mọi lỗi trong block là "không rõ đã gửi", luật chống gửi trùng của report_v1 chặn), dừng chiến dịch ngay.
// Không thấy hai câu thì vẫn FB46 như cũ. Chỉ dữ liệu (không DDL, không nạp lại schema PostgREST), chỉ bản "[engine]" của block (bộ cũ block
// 2679 không đổi), không cần phát hành app (Desktop ≥ 9.9.0 đã có dấu hiệu theo câu block và tự nạp lại element khi gặp tên mới).
//   node scripts/build-v591-sql.cjs            ghi migration + bản gỡ
//   node scripts/build-v591-sql.cjs --check    chỉ kiểm file đang có khớp bộ sinh
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const NAME = 'migration_v591_engine_facebook_page_inbox_signs'
const ROLLBACK_NAME = 'rollback_v591_engine_facebook_page_inbox_signs'
const SOURCE = 'v591'
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const lit = text => text == null ? 'NULL' : `'${String(text).replace(/'/g, "''")}'`
const LIVE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/engine-v2-facebook/v591-live-20261120.json'), 'utf8'))

const ACTION = 'fb_message_page_inbox_customer'
const BLOCK = { id: 2885, name: '[engine] fb_send_page_inbox_message', sourceId: 2679, oldMd5: '86217720edd3c1c04495c7c061d26bea' }
const STEP = { id: 20, commitLevel: 1, sendOps: [] }
const SIGNS_BEFORE_MD5 = '797af9742857b712e1144f5d230b2137'
if (LIVE.block.id !== BLOCK.id || LIVE.block.name !== BLOCK.name || md5(LIVE.block.code) !== BLOCK.oldMd5) throw new Error('Fixture block 2885 lệch')
if (LIVE.copy.source_block_id !== BLOCK.sourceId || LIVE.step.id !== STEP.id || LIVE.step.reviewed_code_md5 !== BLOCK.oldMd5
  || LIVE.step.commit_level !== STEP.commitLevel || JSON.stringify(LIVE.step.send_ops) !== '[]') throw new Error('Fixture danh mục bước / sổ chép lệch')
if (md5(LIVE.signs.value) !== SIGNS_BEFORE_MD5 || LIVE.signs.md5 !== SIGNS_BEFORE_MD5) throw new Error('Fixture dấu hiệu lệch')

// Mã và câu anh duyệt qua hộp chọn 20/11/2026 (câu bước tiếp theo của FB47 đúng nguyên văn anh viết).
const FB26 = { code: 'err_fb_page_inbox_cannot_reply_blocked_by_user', pub: 'FB26', oldTitle: 'Khách không nhận tin nhắn từ Page',
  title: 'Page không gửi được tin cho người này nữa', help: null }
const FB47 = { code: 'err_fb_page_inbox_identity_required', pub: 'FB47', cls: 'account_restricted',
  title: 'Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin', help: 'Vui lòng kiểm tra hộp thư page' }
const FB46 = { code: 'err_fb_page_inbox_message_box_not_found', pub: 'FB46' }
if (LIVE.errors.FB26.error_code !== FB26.code || LIVE.errors.FB26.customer_title !== FB26.oldTitle || LIVE.errors.FB26.customer_help !== null)
  throw new Error('Fixture FB26 lệch')
const note = c => c.help ? `${c.title} (${c.pub}). ${c.help}` : `${c.title} (${c.pub}).`

// Element theo chữ Facebook ghi ở chỗ ô nhập tin (anh muốn selector nằm ở auto_elements để sửa ở màn Element, không cần migration).
// FB26: đúng nguyên câu (nút chữ thật trên trang Page của anh 20/11: <span …>Bạn không thể gửi tin nhắn cho người này nữa. </span><a …>Tìm hiểu
// thêm</a>), so bằng để tin nhắn trong hội thoại bắt đầu bằng câu đó không bị nhận nhầm. FB47: chưa có trang thật, theo ảnh lỗi tổ chức 441
// nên so đầu câu. Thêm bản tiếng Anh bằng `|` khi có mẫu.
const ELEMENTS = [
  { name: 'FbPageInboxCannotSendNotice', xpath: "//text()[normalize-space(.)='Bạn không thể gửi tin nhắn cho người này nữa.']/..",
    description: 'V591: chữ Facebook ghi thay ô nhập tin khi Page không gửi được tin cho người này nữa (FB26). Thêm bản tiếng Anh bằng | khi có mẫu.' },
  { name: 'FbPageInboxIdentityRequiredNotice', xpath: "//text()[starts-with(normalize-space(.), 'Hãy xác nhận danh tính để gửi tin nhắn')]/..",
    description: 'V591: chữ Facebook ghi thay ô nhập tin khi đòi xác nhận danh tính mới cho Page gửi tin (FB47). Thêm bản tiếng Anh bằng | khi có mẫu.' }
]
for (const e of ELEMENTS) if (LIVE.elements.some(x => x.name === e.name)) throw new Error(`Element ${e.name} đã có`)

// Câu block ném (cũng là chữ của dấu hiệu "message": câu dòng lịch sử chứa câu này).
const CANNOT_SEND_MESSAGE = FB26.title
const IDENTITY_MESSAGE = FB47.title

const EDITS = [
  {
    from: "const messageInputFallbackXpath = await helpers.element('FbPageInboxMessengerReplyInput')\n",
    to: "const messageInputFallbackXpath = await helpers.element('FbPageInboxMessengerReplyInput')\n" +
      `const cannotSendNoticeXpath = await helpers.element('${ELEMENTS[0].name}')\n` +
      `const identityRequiredNoticeXpath = await helpers.element('${ELEMENTS[1].name}')\n`
  },
  {
    from: "  if (!typed || typed.found !== true) {\n    throw new Error('Không tìm thấy ô để nhập tin nhắn')\n  }\n",
    to: [
      '  if (!typed || typed.found !== true) {',
      '    // Facebook bỏ ô nhập tin và ghi lý do ở chỗ đó: nhận ra bằng chữ trên trang (element ở auto_elements), không đoán lý do.',
      "    const identityNotice = await dom('exists', { selector: identityRequiredNoticeXpath }).catch(() => null)",
      '    if (identityNotice && identityNotice.ok === true) {',
      `      throw new Error('${IDENTITY_MESSAGE}')`,
      '    }',
      "    const cannotSendNotice = await dom('exists', { selector: cannotSendNoticeXpath }).catch(() => null)",
      '    if (cannotSendNotice && cannotSendNotice.ok === true) {',
      `      throw new Error('${CANNOT_SEND_MESSAGE}')`,
      '    }',
      "    throw new Error('Không tìm thấy ô để nhập tin nhắn')",
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
const Q = '$v591$'
for (const text of [LIVE.block.code, NEW_CODE, ...EDITS.flatMap(e => [e.from, e.to])]) if (text.includes(Q)) throw new Error('Code chứa dấu nháy $v591$')
const dq = text => `${Q}${text}${Q}`

// Dấu hiệu mới đặt ngay trước dấu hiệu FB46 (câu khác hẳn nên thứ tự không đổi kết quả, đặt trước cho rõ ý).
const SIGNS_BEFORE = JSON.parse(LIVE.signs.value)
if (JSON.stringify(SIGNS_BEFORE) !== LIVE.signs.value) throw new Error('Dòng dấu hiệu không phải JSON gọn')
const fb46Index = SIGNS_BEFORE.findIndex(s => s.code === FB46.code)
if (fb46Index < 0) throw new Error('Không thấy dấu hiệu FB46')
const NEW_SIGNS = [
  { code: FB47.code, source: 'message', actions: [ACTION], phases: [], replaces: ['err_undefined'], texts: [IDENTITY_MESSAGE] },
  { code: FB26.code, source: 'message', actions: [ACTION], phases: [], replaces: ['err_undefined'], texts: [CANNOT_SEND_MESSAGE] }
]
const SIGNS_AFTER = [...SIGNS_BEFORE.slice(0, fb46Index), ...NEW_SIGNS, ...SIGNS_BEFORE.slice(fb46Index)]
const SIGNS_AFTER_JSON = JSON.stringify(SIGNS_AFTER)
const SIGNS_AFTER_MD5 = md5(SIGNS_AFTER_JSON)

const POLICY_COLUMNS = ['error_code', 'action_code', 'campaign_action_id', 'detail_status_id', 'detail_mode', 'log_template', 'campaign_note_template',
  'quota_effect', 'target_streak_effect', 'streak_threshold', 'target_effect', 'remaining_steps', 'lock_action_codes', 'lock_mode', 'run_effect',
  'pace_mode', 'campaign_effect', 'account_effect', 'login_effect', 'description', 'source']
// Khai đủ mọi cột hành vi để chính sách gộp không lấy trường nào từ dòng chung của mã / lớp lỗi.
const POLICIES = [
  { error_code: FB26.code, action_code: ACTION, detail_status_id: 21, detail_mode: 'write', log_template: FB26.title, campaign_note_template: note(FB26),
    quota_effect: 'no_count', target_streak_effect: 'ignore', target_effect: 'complete', remaining_steps: 'skip', run_effect: 'continue',
    pace_mode: 'full', campaign_effect: 'none', account_effect: 'none', login_effect: 'none',
    description: '[anh chốt 20/11] FB26 hộp thư Page: Facebook ghi không gửi được tin cho người này nữa; đóng data, ghi thất bại, không tính lượt, không cộng chuỗi, chạy tiếp.' },
  { error_code: FB47.code, action_code: ACTION, detail_status_id: 21, detail_mode: 'write', log_template: FB47.title, campaign_note_template: note(FB47),
    quota_effect: 'no_count', target_streak_effect: 'ignore', target_effect: 'complete', remaining_steps: 'skip', run_effect: 'end_unit',
    pace_mode: 'none', campaign_effect: 'pause', account_effect: 'none', login_effect: 'none',
    description: '[anh chốt 20/11] FB47 hộp thư Page: Facebook đòi xác nhận danh tính; dừng chiến dịch ngay, đóng data (không trả về hàng đợi được vì không rõ đã gửi), không tính lượt.' }
].map(p => ({ ...p, lock_action_codes: [], lock_mode: 'fixed_minutes', source: SOURCE }))
const policyValues = POLICIES.map(p => `  (${POLICY_COLUMNS.map(col => {
  const v = p[col]
  if (v === undefined || v === null) return 'NULL'
  if (Array.isArray(v)) return `ARRAY[${v.map(lit).join(', ')}]::text[]`
  return typeof v === 'number' ? String(v) : lit(v)
}).join(', ')})`).join(',\n')

// Kết quả phải ra sau khi apply (chính sách gộp ở hộp thư Page, mọi pha; FB46 giữ như V575).
const EXPECT = [
  [FB26.code, { target_effect: 'complete', target_streak_effect: 'ignore', campaign_effect: 'none', quota_effect: 'no_count', detail_status_id: '21',
    run_effect: 'continue', log_template: FB26.title, streak_threshold: null }],
  [FB47.code, { target_effect: 'complete', target_streak_effect: 'ignore', campaign_effect: 'pause', quota_effect: 'no_count', detail_status_id: '21',
    run_effect: 'end_unit', log_template: FB47.title, campaign_note_template: note(FB47), streak_threshold: null }],
  [FB46.code, { target_effect: 'complete', target_streak_effect: 'increment', campaign_effect: 'pause', quota_effect: 'no_count', detail_status_id: '22',
    streak_threshold: '8' }]
]
const policyChecks = EXPECT.flatMap(([code, fields]) => ['before_send', 'in_flight', 'after_send'].map(phase => `
  v_p := public.aka_agent_engine_resolve_policy(${lit(code)}, NULL, ${lit(ACTION)}, 'facebook_page_to_message', 'desktop', ${lit(phase)});
  IF ${Object.entries(fields).map(([k, v]) => `v_p->>${lit(k)} IS DISTINCT FROM ${v === null ? 'NULL' : lit(v)}`).join('\n     OR ')} THEN
    RAISE EXCEPTION 'V591 postflight: chính sách % (%) ra %', ${lit(code)}, ${lit(phase)}, v_p;
  END IF;`)).join('')

// Tín hiệu đúng dạng Desktop gửi khi dấu hiệu khớp (như FB46 trong auto_engine_outcomes 19–20/11).
const CLASSIFY = [
  [FB26.code, `Lỗi nhắn tin khách inbox page đến A: ${CANNOT_SEND_MESSAGE}`],
  [FB47.code, `Lỗi nhắn tin khách inbox page đến A: ${IDENTITY_MESSAGE}`],
  [FB46.code, 'Lỗi nhắn tin khách inbox page đến A: Không tìm thấy ô để nhập tin nhắn']
]
const classifyChecks = CLASSIFY.map(([code, message]) => `
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', ${lit(ACTION)}, 'in_flight',
    ${lit(JSON.stringify({ kind: 'block', code, errorCode: code, message }))}::jsonb) c;
  IF v_text IS DISTINCT FROM ${lit(code)} THEN RAISE EXCEPTION 'V591 postflight: tín hiệu % ra %', ${lit(code)}, v_text; END IF;`).join('')

const elementValues = ELEMENTS.map(e => `  (${lit(e.name)}, ${lit(e.xpath)}, ${lit(e.description)}, 'facebook', true, NULL, NULL)`).join(',\n')
const elementNames = ELEMENTS.map(e => lit(e.name)).join(', ')

const migration = `-- ${NAME}: tách FB46 (hộp thư Page không thấy ô nhập tin) theo chữ Facebook ghi ở chỗ ô nhập tin. Anh chốt 20/11/2026
-- (docs/ENGINE_V2_FACEBOOK_PAGE_INBOX_V591.md). Sinh bằng scripts/build-v591-sql.cjs (nguồn kiểm scripts/fixtures/engine-v2-facebook/
-- v591-live-20261120.json), không sửa tay. Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST).
--   * Hai element mới ở auto_elements (${ELEMENTS.map(e => e.name).join(', ')}), sửa XPath ở màn Element khi Facebook đổi chữ.
--   * Bản "[engine]" của block gửi tin hộp thư Page (2885; bộ cũ 2679 không đổi): không thấy ô nhập tin thì dò hai câu đó, thấy thì báo câu riêng.
--   * Hai dấu hiệu "message" ở facebook.error_signs đổi câu đó ra FB47 / FB26 (thay err_undefined như FB46).
--   * FB26 (mã có sẵn, chưa chỗ nào phát): câu cho khách "${FB26.title}"; chính sách hộp thư Page: đóng data, ghi thất bại, không tính lượt,
--     không cộng chuỗi, chạy tiếp.
--   * FB47 mới "${FB47.title}" (${FB47.help}): dừng chiến dịch ngay, đóng data, không tính lượt.
-- Không thấy hai câu thì vẫn FB46 như V575. Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v591_%') THEN
      RAISE EXCEPTION 'V591: sổ migration đã có migration_v591_%%, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND name = ${lit(BLOCK.name)} AND md5(code) = '${BLOCK.oldMd5}') THEN
    RAISE EXCEPTION 'V591: block ${BLOCK.id} khác bản đã đọc (md5 ${BLOCK.oldMd5}), đọc lại và sinh lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = ${BLOCK.id} AND source_block_id = ${BLOCK.sourceId}) THEN
    RAISE EXCEPTION 'V591: thiếu sổ chép block ${BLOCK.id}';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id};
  IF v_n <> 1 THEN RAISE EXCEPTION 'V591: block ${BLOCK.id} có % dòng danh mục bước, cần 1', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND commit_level = ${STEP.commitLevel}
                   AND send_ops = '${JSON.stringify(STEP.sendOps)}'::jsonb AND reviewed_code_md5 = '${BLOCK.oldMd5}') THEN
    RAISE EXCEPTION 'V591: dòng danh mục bước ${STEP.id} khác bản đã đọc';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '${SIGNS_BEFORE_MD5}' THEN
    RAISE EXCEPTION 'V591: dòng facebook.error_signs đã đổi';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_elements WHERE name IN (${elementNames})) THEN
    RAISE EXCEPTION 'V591: đã có element mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(FB26.code)} AND public_code = 'FB26' AND is_active AND NOT is_delete
                   AND customer_title = ${lit(FB26.oldTitle)} AND customer_help IS NULL) THEN
    RAISE EXCEPTION 'V591: mã FB26 khác bản đã đọc';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(FB46.code)} AND public_code = 'FB46' AND is_active AND NOT is_delete) THEN
    RAISE EXCEPTION 'V591: thiếu mã FB46';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(FB47.code)} OR public_code = 'FB47') THEN
    RAISE EXCEPTION 'V591: đã có mã FB47';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = ${lit(SOURCE)})
     OR EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = ${lit(FB26.code)} AND action_code = ${lit(ACTION)} AND is_active AND NOT is_delete) THEN
    RAISE EXCEPTION 'V591: đã có chính sách FB26 ở hộp thư Page hoặc dòng nguồn ${SOURCE}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_status WHERE id = 21 AND code = 'campaign_detail_failed' AND status_value = 'thất bại') THEN
    RAISE EXCEPTION 'V591: trạng thái 21 không phải "thất bại"';
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

-- FB26: chỉ câu cho khách của engine (bộ cũ đọc noti_*, giữ nguyên).
UPDATE public.auto_error SET customer_title = ${lit(FB26.title)}, updated_at = now()
 WHERE error_code = ${lit(FB26.code)} AND customer_title = ${lit(FB26.oldTitle)};

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', ${lit(FB47.code)}, ${lit(FB47.title)}, ${lit(`V591 (engine v2): ${FB47.title}`)}, NULL, NULL, '{}', false, false, 'fixed_minutes',
  '{}', '{}', true, false, ${lit(FB47.pub)}, ${lit(FB47.cls)}, ${lit(FB47.title)}, ${lit(FB47.help)});

INSERT INTO public.auto_outcome_policies (${POLICY_COLUMNS.join(', ')}) VALUES
${policyValues};

DO $post$
DECLARE v_p jsonb; v_text text; v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V591 postflight: code block ${BLOCK.id} không ra đúng bản mong đợi (md5 ${NEW_MD5})';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id} AND reviewed_code_md5 IS DISTINCT FROM '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V591 postflight: danh mục bước của block ${BLOCK.id} chưa ghi md5 mới';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '${SIGNS_AFTER_MD5}' THEN
    RAISE EXCEPTION 'V591 postflight: dòng facebook.error_signs';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_elements WHERE (name, xpath) IN (${ELEMENTS.map(e => `(${lit(e.name)}, ${lit(e.xpath)})`).join(', ')});
  IF v_n <> ${ELEMENTS.length} THEN RAISE EXCEPTION 'V591 postflight: % element mới', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE source = ${lit(SOURCE)} AND is_active AND NOT is_delete;
  IF v_n <> ${POLICIES.length} THEN RAISE EXCEPTION 'V591 postflight: % dòng chính sách mới', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(FB26.code)} AND customer_title = ${lit(FB26.title)} AND customer_help IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(FB47.code)} AND public_code = 'FB47' AND is_active
                      AND customer_title = ${lit(FB47.title)} AND customer_help = ${lit(FB47.help)}) THEN
    RAISE EXCEPTION 'V591 postflight: câu FB26 / FB47';
  END IF;
${policyChecks}
${classifyChecks}
END $post$;

COMMIT;
`

const rollback = `-- Gỡ ${NAME}: trả block 2885, danh mục bước 20, dòng facebook.error_signs và câu FB26 về bản trước V591; tắt FB47 và hai dòng chính sách
-- nguồn ${SOURCE} (không xoá: auto_engine_outcomes có thể đã giữ mã); xoá hai element mới sau khi block không còn đọc. Chỉ chạy khi block đang
-- đúng bản V591 (đã ai sửa sau V591 thì dừng, không ghi đè). Sinh bằng scripts/build-v591-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V591: block ${BLOCK.id} khác bản V591 (md5 ${NEW_MD5})';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '${SIGNS_AFTER_MD5}' THEN
    RAISE EXCEPTION 'Gỡ V591: dòng facebook.error_signs khác bản V591';
  END IF;
END $pre$;

${[...EDITS].reverse().map(e => `UPDATE public.auto_blocks SET code = replace(code, ${dq(e.to)}, ${dq(e.from)}), updated_at = now()
 WHERE id = ${BLOCK.id};`).join('\n')}
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${BLOCK.oldMd5}', updated_at = now()
 WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND reviewed_code_md5 = '${NEW_MD5}';
UPDATE public.auto_system_settings SET value = ${lit(LIVE.signs.value)}, updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = '${SIGNS_AFTER_MD5}';
UPDATE public.auto_outcome_policies SET is_active = false WHERE source = ${lit(SOURCE)} AND is_active;
UPDATE public.auto_error SET is_active = false, updated_at = now() WHERE error_code = ${lit(FB47.code)};
UPDATE public.auto_error SET customer_title = ${lit(FB26.oldTitle)}, updated_at = now()
 WHERE error_code = ${lit(FB26.code)} AND customer_title = ${lit(FB26.title)};
DELETE FROM public.auto_elements WHERE name IN (${elementNames});

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${BLOCK.oldMd5}')
     OR EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id} AND reviewed_code_md5 IS DISTINCT FROM '${BLOCK.oldMd5}')
     OR (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '${SIGNS_BEFORE_MD5}'
     OR EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = ${lit(SOURCE)} AND is_active)
     OR EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(FB47.code)} AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(FB26.code)} AND customer_title = ${lit(FB26.oldTitle)})
     OR EXISTS (SELECT 1 FROM public.auto_elements WHERE name IN (${elementNames})) THEN
    RAISE EXCEPTION 'Gỡ V591: dữ liệu chưa về bản trước V591';
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

module.exports = { NAME, ROLLBACK_NAME, SOURCE, ACTION, BLOCK, STEP, FB26, FB46, FB47, ELEMENTS, EDITS, NEW_CODE, NEW_MD5, SIGNS_BEFORE_MD5,
  SIGNS_AFTER_JSON, SIGNS_AFTER_MD5, POLICIES, CANNOT_SEND_MESSAGE, IDENTITY_MESSAGE, LIVE, migration, rollback }
