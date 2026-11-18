#!/usr/bin/env node
// Sinh migration V575 (anh chốt 18/11/2026, docs/ENGINE_V2_FACEBOOK_PROGRESS_PARITY.md mục 7, 10, 11). Chỉ dữ liệu, cộng thân hàm
// aka_agent_engine_wait_note (CREATE OR REPLACE: PostgREST nạp lại schema, apply ngoài giờ cao điểm). Bộ cũ không đổi: chỉ thêm mã loại
// 'engine v2', chỉ sửa customer_title / customer_help (bộ cũ đọc noti_*), luật / chính sách engine.
//   node scripts/build-v575-sql.cjs   → migrations/migration_v575_engine_specific_codes_wait_note.sql + rollback
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const NAME = 'migration_v575_engine_specific_codes_wait_note'
const ROLLBACK_NAME = 'rollback_v575_engine_specific_codes_wait_note'
const SOURCE = 'v575'
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const lit = text => text == null ? 'NULL' : `'${String(text).replace(/'/g, "''")}'`

// Đọc production 18/11/2026 (chỉ đọc): dòng facebook.error_signs (V559 + V563, 5 dấu hiệu) và thân hàm câu chờ (V495).
const SIGNS_BEFORE = [
  { code: 'err_fb_page_inbox_customer_not_found', source: 'message', actions: ['fb_message_page_inbox_customer'], phases: [], replaces: [],
    texts: ['Không tìm thấy khách hàng trong inbox page'] },
  { code: 'err_fb_page_inbox_wrong_conversation', source: 'message', actions: ['fb_message_page_inbox_customer'], phases: [], replaces: [],
    texts: ['Không tìm thấy đúng khách hàng trong inbox page'] },
  { code: 'err_fb_upload_form_changed', source: 'message', actions: [], phases: ['before_send'], replaces: [],
    texts: ['Cần đúng 1 input file trong form đăng bài, tìm thấy 0', 'Input trong form không nhận ảnh/video'] },
  { code: 'err_fb_group_cannot_post_unavailable', source: 'page', actions: ['fb_post_group'], phases: [], replaces: ['err_fb_group_composer_editor_not_found'],
    texts: ['Bạn hiện không xem được nội dung này', "This content isn't available right now"] },
  { code: 'err_fb_group_cannot_post_not_member', source: 'page', actions: ['fb_post_group'], phases: [], replaces: ['err_fb_group_composer_editor_not_found'],
    texts: ['Tham gia nhóm', 'Join group'] }
]
const SIGNS_BEFORE_MD5 = '7e25dd65faab148bcf55b93654852a16'
const WAIT_NOTE_BEFORE_MD5 = 'a288740dc85596850d80d0f44d60f7c9'
const SIGNS_BEFORE_JSON = JSON.stringify(SIGNS_BEFORE)
if (md5(SIGNS_BEFORE_JSON) !== SIGNS_BEFORE_MD5) throw new Error(`Bản chép dấu hiệu lệch production: ${md5(SIGNS_BEFORE_JSON)}`)

// Dấu hiệu mới (câu block: chứa). FB41 chỉ cho dòng comment chưa có mã (hôm nay ra FB42 qua luật trạng thái); FB46 thay mã err_undefined
// mà block hộp thư Page tự báo.
const FB41 = { code: 'err_fb_comment_box_not_found', pub: 'FB41' }
const FB46 = { code: 'err_fb_page_inbox_message_box_not_found', pub: 'FB46', cls: 'ui_changed',
  title: 'Không thấy ô nhập tin nhắn trong hộp thư Page', help: 'Mở tab trình duyệt của tài khoản để kiểm tra.' }
const MEDIA_HELP = 'Mở chiến dịch, chọn lại ảnh, video hoặc tệp rồi bấm Tiếp tục chiến dịch.'
const CFG20 = { code: 'err_media_local_file_missing', pub: 'CFG20', cls: 'content_config',
  title: 'Ảnh, video hoặc tệp của chiến dịch không còn trên máy', help: MEDIA_HELP }
const CFG01 = { code: 'err_media_file_missing', pub: 'CFG01', title: 'Không tải được ảnh, video hoặc tệp của chiến dịch', help: MEDIA_HELP,
  oldTitle: 'Không dùng được tệp media của chiến dịch' }
const note = c => `${c.title} (${c.pub}). ${c.help}`

const NEW_SIGNS = [
  { code: FB41.code, source: 'message', actions: ['fb_comment'], phases: [], replaces: [], texts: ['waitForSelector timeout'] },
  { code: FB46.code, source: 'message', actions: ['fb_message_page_inbox_customer'], phases: [], replaces: ['err_undefined'],
    texts: ['Không tìm thấy ô để nhập tin nhắn'] }
]
const SIGNS_AFTER_JSON = JSON.stringify([...SIGNS_BEFORE, ...NEW_SIGNS])

const POLICY_COLUMNS = ['error_code', 'action_code', 'campaign_action_id', 'detail_status_id', 'detail_mode', 'log_template', 'campaign_note_template', 'quota_effect',
  'target_streak_effect', 'streak_threshold', 'target_effect', 'remaining_steps', 'lock_action_codes', 'lock_mode', 'run_effect', 'pace_mode',
  'campaign_effect', 'account_effect', 'login_effect', 'description', 'source']
// Loại chiến dịch có dòng comment của bộ dựng lịch sử cũ ("Không comment được …: waitForSelector timeout …", hôm nay FB42): dấu hiệu gắn FB41.
// Up tin (facebook_comment_seeding_post) không nằm đây: block của Up tin tự phát FB41 từ V472, giữ dòng 339 như bộ cũ (không tính lượt).
const FB41_SIGN_CAMPAIGN_ACTIONS = ['facebook_group_post', 'facebook_comment_seeding', 'facebook_timeline_post', 'facebook_newsfeed_interaction']
const POLICIES = [
  // FB41 khi comment (dấu hiệu): như FB42 hôm nay (tính lượt), câu {message} (Desktop từ bản sau bỏ phần XPath: "… bài thứ 2: không thấy ô
  // bình luận"). Một dòng mỗi loại chiến dịch.
  ...FB41_SIGN_CAMPAIGN_ACTIONS.map(campaignAction => ({ error_code: FB41.code, action_code: 'fb_comment', campaign_action_id: campaignAction,
    quota_effect: 'count', log_template: '{message}',
    description: '[anh chốt 18/11] FB41 khi comment (dấu hiệu, trước đây FB42): giữ cách xử lý như FB42 hôm nay (tính lượt), câu {message}.' })),
  // FB46: như SYS99 hôm nay ở hộp thư Page (dòng 355: ghi "lỗi", không tính lượt, cộng chuỗi, tạm dừng ở ngưỡng 8), chỉ đổi câu.
  { error_code: FB46.code, action_code: 'fb_message_page_inbox_customer', detail_status_id: 22, detail_mode: 'write', log_template: FB46.title,
    campaign_note_template: note(FB46), quota_effect: 'no_count', target_streak_effect: 'increment', streak_threshold: 8, target_effect: 'complete',
    remaining_steps: 'skip', run_effect: 'continue', pace_mode: 'full', campaign_effect: 'pause', account_effect: 'none', login_effect: 'none',
    description: '[anh chốt 18/11] FB46: giữ cách xử lý như SYS99 hôm nay ở hộp thư Page, chỉ đổi câu.' },
  // CFG20: như CFG01 (dòng 96: tạm dừng chiến dịch ngay, data về hàng đợi, không ghi lịch sử, không cộng chuỗi), mọi nơi chạy.
  { error_code: CFG20.code, detail_mode: 'suppress', log_template: CFG20.title, campaign_note_template: note(CFG20), quota_effect: 'no_count',
    target_streak_effect: 'ignore', target_effect: 'requeue', remaining_steps: 'continue', run_effect: 'end_unit', pace_mode: 'full',
    campaign_effect: 'pause', account_effect: 'none', login_effect: 'none',
    description: '[anh chốt 18/11] CFG20 tệp chỉ có trên máy mà không còn: cách xử lý như CFG01 (dừng ngay, data giữ lại).' }
  // Mọi dòng khai lock_mode / lock_action_codes như dòng V559 / CFG01 (cột không có mặc định; thiếu thì chính sách gộp mất trường lock_mode).
].map(p => ({ ...p, lock_action_codes: [], lock_mode: 'fixed_minutes', source: SOURCE }))
const policyValues = POLICIES.map(p => `  (${POLICY_COLUMNS.map(col => {
  const v = p[col]
  if (v === undefined || v === null) return 'NULL'
  if (Array.isArray(v)) return `ARRAY[${v.map(lit).join(', ')}]::text[]`
  return typeof v === 'number' ? String(v) : lit(v)
}).join(', ')})`).join(',\n')

const NETWORK_ERRORS = ['ERR_NETWORK_IO_SUSPENDED', 'ERR_INTERNET_DISCONNECTED', 'ERR_NETWORK_CHANGED']
const RULES = [
  ...NETWORK_ERRORS.map(err => ({ phase: 'before_send', pattern: `%${err}%`, priority: 20, error_code: 'err_network_offline',
    note: `[anh chốt 18/11] ${err} trước lúc gửi (mở trang): mạng trên máy gián đoạn → NET01, data về hàng đợi.` })),
  // Lỗi tệp trong block (nội dung xoay vòng lấy tệp lúc gõ nội dung): như Zalo. Cụ thể trước (ưu tiên 10), chung sau (20).
  { phase: null, pattern: '%Không dùng được media%local path không tồn tại và không có cloud URL%', priority: 10, error_code: CFG20.code,
    note: '[anh chốt 18/11] Tệp chỉ có trên máy mà không còn → CFG20 (trước đây SYS99).' },
  { phase: null, pattern: '%Không dùng được media%', priority: 20, error_code: CFG01.code,
    note: '[anh chốt 18/11] Tệp tải từ kho lưu trữ không được / không có nguồn → CFG01 như Zalo (trước đây SYS99).' }
]
const ruleValues = RULES.map(r =>
  `  ('facebook', NULL, ${lit(r.phase)}, 'message_like', ${lit(r.pattern)}, ${r.priority}, ${lit(r.error_code)}, ${lit(r.note)}, ${lit(SOURCE)}, true)`).join(',\n')

const WAIT_NOTE_HEAD = `CREATE OR REPLACE FUNCTION public.aka_agent_engine_wait_note(p_error_code text, p_until timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$`
const WAIT_NOTE_SQL = `${WAIT_NOTE_HEAD}
  SELECT '⏳ ' || coalesce(e.customer_title, e.error_name, 'Tạm chờ') ||
    CASE WHEN p_until IS NULL THEN ''
         -- Chờ tới 00:00 (hạn mức ngày): chiến dịch chạy lại theo giờ đã cài, nên chỉ ghi ngày (anh chốt 18/11/2026).
         WHEN to_char(p_until AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI') = '00:00'
           THEN ', chạy tiếp vào ngày ' || to_char(p_until AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM')
         ELSE ', chạy tiếp lúc ' || public.aka_agent_engine_format_vn(p_until) END ||
    CASE WHEN e.public_code IS NOT NULL THEN ' (' || e.public_code || ')' ELSE '' END
  FROM (SELECT 1) one LEFT JOIN public.auto_error e ON e.error_code = p_error_code
$function$`
// Thân V495 như production trả qua pg_get_functiondef (md5 a288740d…), để bản gỡ trả về đúng từng byte.
const WAIT_NOTE_BEFORE_SQL = `${WAIT_NOTE_HEAD}
  SELECT '⏳ ' || coalesce(e.customer_title, e.error_name, 'Tạm chờ') ||
    CASE WHEN p_until IS NOT NULL THEN ', chạy tiếp lúc ' || public.aka_agent_engine_format_vn(p_until) ELSE '' END ||
    CASE WHEN e.public_code IS NOT NULL THEN ' (' || e.public_code || ')' ELSE '' END
  FROM (SELECT 1) one LEFT JOIN public.auto_error e ON e.error_code = p_error_code
$function$`
if (md5(`${WAIT_NOTE_BEFORE_SQL}\n`) !== WAIT_NOTE_BEFORE_MD5) throw new Error(`Thân câu chờ cũ lệch production: ${md5(`${WAIT_NOTE_BEFORE_SQL}\n`)}`)
const WAIT_NOTE_AFTER_MD5 = md5(`${WAIT_NOTE_SQL}\n`)

// Kiểm "cách xử lý như mã cũ": bỏ câu, mã, lớp, id dòng (requeue_after không dùng khi target_effect khác requeue_after).
const PARITY_DROP = `- 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template' - 'requeue_after_minutes'`
const PARITY = [
  // [mã mới, mã hôm nay, thao tác, loại chiến dịch, nơi chạy, pha, target_effect phải ra]
  ...FB41_SIGN_CAMPAIGN_ACTIONS.flatMap(ca =>
    ['before_send', 'after_send', 'in_flight'].map(ph => [FB41.code, 'err_engine_fb_action_failed', 'fb_comment', ca, 'desktop', ph, 'complete'])),
  ...['in_flight', 'before_send', 'after_send'].map(ph => [FB46.code, 'err_undefined', 'fb_message_page_inbox_customer', 'facebook_page_to_message', 'desktop', ph, 'complete']),
  ...[['fb_post_group', 'facebook_group_post'], ['fb_post_timeline', 'facebook_timeline_post'], ['fb_comment', 'facebook_comment_seeding'],
    ['fb_message_page_inbox_customer', 'facebook_page_to_message'], ['fb_message', 'facebook_message_uid']].map(([a, ca]) =>
    [CFG20.code, CFG01.code, a, ca, 'desktop', 'before_send', 'requeue']),
  ...[['zalo_message_stranger', 'zalo_message_phone'], ['zalo_message_group', 'zalo_message_group'], ['zalo_message_friend', 'zalo_message_friend'],
    ['zalo_add_friend', 'zalo_message_phone']].flatMap(([a, ca]) => ['desktop', 'fly'].map(rt => [CFG20.code, CFG01.code, a, ca, rt, 'before_send', 'requeue']))
]
const parityChecks = PARITY.map(([newCode, oldCode, action, campaignAction, runtime, phase, effect]) => `
  v_new := public.aka_agent_engine_resolve_policy(${lit(newCode)}, NULL, ${lit(action)}, ${lit(campaignAction)}, ${lit(runtime)}, ${lit(phase)});
  v_old := public.aka_agent_engine_resolve_policy(${lit(oldCode)}, NULL, ${lit(action)}, ${lit(campaignAction)}, ${lit(runtime)}, ${lit(phase)});
  IF (v_new ${PARITY_DROP}) IS DISTINCT FROM (v_old ${PARITY_DROP}) OR v_new->>'target_effect' IS DISTINCT FROM ${lit(effect)} THEN
    RAISE EXCEPTION 'V575 postflight: % (%, %, %, %) khác %: % / %', ${lit(newCode)}, ${lit(action)}, ${lit(campaignAction)}, ${lit(runtime)}, ${lit(phase)}, ${lit(oldCode)}, v_new, v_old;
  END IF;`).join('')

// Tín hiệu mẫu theo auto_engine_outcomes production 18/11 (đã bỏ phần nhận dạng nhóm / tệp).
const CLASSIFY = [
  ['fb_post_group', 'before_send', { kind: 'block', code: 'navigate:www.facebook.com/groups/1', message: "ERR_NETWORK_IO_SUSPENDED (-331) loading 'https://www.facebook.com/groups/1'" }, 'err_network_offline'],
  ['fb_post_group', 'before_send', { kind: 'block', code: 'navigate:www.facebook.com/groups/1', message: "ERR_INTERNET_DISCONNECTED (-106) loading 'https://www.facebook.com/groups/1'" }, 'err_network_offline'],
  ['fb_comment', 'before_send', { kind: 'exception', message: 'net::ERR_NETWORK_CHANGED' }, 'err_network_offline'],
  ['fb_post_group', 'in_flight', { kind: 'block', code: 'navigate:www.facebook.com/groups/1', message: "ERR_NETWORK_IO_SUSPENDED (-331) loading 'https://www.facebook.com/groups/1'" }, null],
  ['fb_post_group', 'before_send', { kind: 'exception', message: 'Không dùng được media "a.jpg": local path không tồn tại và không có cloud URL fallback' }, CFG20.code],
  ['fb_post_group', 'before_send', { kind: 'exception', message: 'Không dùng được media "a.jpg": local path không tồn tại và cloud URL không tải được (HTTP 404)' }, CFG01.code],
  ['fb_message_page_inbox_customer', 'before_send', { kind: 'exception', message: 'Không dùng được media "a.jpg": không có local path và cloud URL không tải được (The operation was aborted due to timeout)' }, CFG01.code],
  ['fb_post_group', 'before_send', { kind: 'block', code: 'wait:fb_post_button', message: 'waitForSelector timeout: //div' }, 'err_engine_fb_ui_not_ready'],
  ['zalo_message_stranger', 'before_send', { kind: 'engine', code: 'media_unavailable', errorCode: CFG20.code, message: 'Không dùng được media "a.jpg": local path không tồn tại và không có cloud URL fallback' }, CFG20.code],
  ['fb_comment', 'after_send', { kind: 'block', code: 'status:campaign_detail_failed', errorCode: FB41.code, message: 'Không comment được bài thứ 2: không thấy ô bình luận' }, FB41.code],
  ['fb_message_page_inbox_customer', 'in_flight', { kind: 'block', code: FB46.code, errorCode: FB46.code, message: 'Lỗi nhắn tin khách inbox page đến A: Không tìm thấy ô để nhập tin nhắn' }, FB46.code]
]
const classifyChecks = CLASSIFY.map(([action, phase, signal, expected]) => {
  const platform = action.startsWith('zalo_') ? 'zalo' : 'facebook'
  // expected null: lỗi mạng lúc đang gửi giữ như hôm nay (không ra NET01).
  const bad = expected === null ? `v_text = 'err_network_offline'` : `v_text IS DISTINCT FROM ${lit(expected)}`
  return `
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal(${lit(platform)}, ${lit(action)}, ${lit(phase)}, ${lit(JSON.stringify(signal))}::jsonb) c;
  IF ${bad} THEN
    RAISE EXCEPTION 'V575 postflight: tín hiệu % (%) ra %, cần %', ${lit(signal.message)}, ${lit(phase)}, v_text, ${lit(expected ?? 'khác NET01')};
  END IF;`
}).join('')

const migration = `-- ${NAME}: engine v2 phát mã cụ thể thay câu thô, NET01 cho lỗi mạng khi mở trang Facebook, hai mã lỗi tệp theo nguyên nhân, câu chờ
-- hạn mức ngày chỉ ghi ngày. Anh chốt 18/11/2026 (docs/ENGINE_V2_FACEBOOK_PROGRESS_PARITY.md). Sinh bằng scripts/build-v575-sql.cjs, không sửa tay.
--   * FB41 (comment không thấy ô bình luận): dấu hiệu "waitForSelector timeout" ở dòng comment (Desktop gắn mã); như FB42 hôm nay ở đăng
--     nhóm, comment seeding, trang cá nhân, newsfeed. Up tin tự phát FB41 từ block (V472) nên giữ dòng 339 như bộ cũ.
--   * FB46 mới (hộp thư Page không thấy ô nhập tin) thay err_undefined block tự báo; như SYS99 hôm nay ở hộp thư Page.
--   * Lỗi tệp: CFG20 mới "tệp không còn trên máy", CFG01 đổi câu thành "không tải được"; cả hai dừng chiến dịch ngay, data giữ lại (cách
--     của CFG01 trên Zalo). Facebook: luật theo câu lỗi trong block (trước đây SYS99). Zalo: Desktop gửi CFG20 từ bản app sau, tới lúc đó
--     Zalo vẫn CFG01 cho cả hai nguyên nhân.
--   * ERR_NETWORK_IO_SUSPENDED / ERR_INTERNET_DISCONNECTED / ERR_NETWORK_CHANGED khi mở trang Facebook trước lúc gửi: NET01 (data về hàng
--     đợi, không cộng chuỗi; trước đây FB44).
--   * aka_agent_engine_wait_note: chờ tới 00:00 ghi "chạy tiếp vào ngày DD/MM" (LIM01 và mọi mã chờ qua ngày, Zalo lẫn Facebook).
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v575_%') THEN
    RAISE EXCEPTION 'V575: sổ migration đã có migration_v575_%%, không chạy lại';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code IN (${lit(FB46.code)}, ${lit(CFG20.code)}) OR public_code IN ('FB46', 'CFG20')) THEN
    RAISE EXCEPTION 'V575: đã có mã FB46 / CFG20';
  END IF;
  IF (SELECT count(*) FROM public.auto_error WHERE is_active AND NOT is_delete AND (error_code, public_code) IN
      ((${lit(FB41.code)}, 'FB41'), ('err_network_offline', 'NET01'), ('error_limit_in_day', 'LIM01'), ('err_engine_fb_action_failed', 'FB42'),
       ('err_undefined', 'SYS99'))) <> 5 THEN
    RAISE EXCEPTION 'V575: thiếu mã FB41 / NET01 / LIM01 / FB42 / SYS99';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(CFG01.code)} AND public_code = 'CFG01' AND is_active AND NOT is_delete
                   AND customer_title = ${lit(CFG01.oldTitle)} AND customer_help IS NULL) THEN
    RAISE EXCEPTION 'V575: câu của CFG01 đã đổi';
  END IF;
  IF (SELECT count(*) FROM public.auto_outcome_policies WHERE error_code = ${lit(CFG01.code)} AND is_active AND NOT is_delete) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = ${lit(CFG01.code)} AND is_active AND NOT is_delete
                      AND action_code IS NULL AND status_id IS NULL AND campaign_action_id IS NULL AND runtime_target IS NULL AND error_class IS NULL
                      AND log_template = ${lit(CFG01.oldTitle)} AND campaign_note_template = ${lit(CFG01.oldTitle)}) THEN
    RAISE EXCEPTION 'V575: chính sách CFG01 khác bản đọc 18/11';
  END IF;
  SELECT md5(value) INTO v_md5 FROM public.auto_system_settings WHERE key = 'facebook.error_signs';
  IF v_md5 IS DISTINCT FROM '${SIGNS_BEFORE_MD5}' THEN RAISE EXCEPTION 'V575: dòng facebook.error_signs đã đổi (md5 %)', v_md5; END IF;
  SELECT md5(pg_get_functiondef('public.aka_agent_engine_wait_note(text, timestamp with time zone)'::regprocedure)) INTO v_md5;
  IF v_md5 IS DISTINCT FROM '${WAIT_NOTE_BEFORE_MD5}' THEN RAISE EXCEPTION 'V575: aka_agent_engine_wait_note đã đổi (md5 %)', v_md5; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = ${lit(SOURCE)})
     OR EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = ${lit(SOURCE)}) THEN
    RAISE EXCEPTION 'V575: đã có dòng nguồn ${SOURCE}';
  END IF;
END $pre$;

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES
${[FB46, CFG20].map(c => `  ('engine v2', ${lit(c.code)}, ${lit(c.title)}, ${lit(`V575 (engine v2): ${c.title}`)}, NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}', true, false, ${lit(c.pub)}, ${lit(c.cls)}, ${lit(c.title)}, ${lit(c.help)})`).join(',\n')};

-- CFG01: chỉ câu cho khách của engine (bộ cũ đọc noti_running_process / noti_campaign, giữ nguyên).
UPDATE public.auto_error SET customer_title = ${lit(CFG01.title)}, customer_help = ${lit(CFG01.help)}, updated_at = now()
 WHERE error_code = ${lit(CFG01.code)} AND customer_title = ${lit(CFG01.oldTitle)};

INSERT INTO public.auto_outcome_policies (${POLICY_COLUMNS.join(', ')}) VALUES
${policyValues};

UPDATE public.auto_outcome_policies SET log_template = ${lit(CFG01.title)}, campaign_note_template = ${lit(note(CFG01))}
 WHERE error_code = ${lit(CFG01.code)} AND is_active AND NOT is_delete AND action_code IS NULL AND status_id IS NULL AND campaign_action_id IS NULL
   AND runtime_target IS NULL AND error_class IS NULL AND log_template = ${lit(CFG01.oldTitle)};

UPDATE public.auto_system_settings SET value = ${lit(SIGNS_AFTER_JSON)}, updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = '${SIGNS_BEFORE_MD5}';

INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, note, source, is_active) VALUES
${ruleValues};

${WAIT_NOTE_SQL};

DO $post$
DECLARE v_new jsonb; v_old jsonb; v_text text; v_n int;
BEGIN
  SELECT md5(value) INTO v_text FROM public.auto_system_settings WHERE key = 'facebook.error_signs';
  IF v_text IS DISTINCT FROM '${md5(SIGNS_AFTER_JSON)}' THEN RAISE EXCEPTION 'V575 postflight: dòng facebook.error_signs (md5 %)', v_text; END IF;
  SELECT md5(pg_get_functiondef('public.aka_agent_engine_wait_note(text, timestamp with time zone)'::regprocedure)) INTO v_text;
  IF v_text IS DISTINCT FROM '${WAIT_NOTE_AFTER_MD5}' THEN RAISE EXCEPTION 'V575 postflight: thân câu chờ (md5 %)', v_text; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE source = ${lit(SOURCE)} AND is_active AND NOT is_delete;
  IF v_n <> ${POLICIES.length} THEN RAISE EXCEPTION 'V575 postflight: % dòng chính sách mới', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_signal_rules WHERE source = ${lit(SOURCE)} AND is_active;
  IF v_n <> ${RULES.length} THEN RAISE EXCEPTION 'V575 postflight: % luật mới', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE error_code = ${lit(CFG01.code)} AND is_active AND NOT is_delete
    AND log_template = ${lit(CFG01.title)} AND campaign_note_template = ${lit(note(CFG01))};
  IF v_n <> 1 THEN RAISE EXCEPTION 'V575 postflight: câu chính sách CFG01'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_error WHERE error_code = ${lit(CFG01.code)} AND customer_title = ${lit(CFG01.title)} AND customer_help = ${lit(CFG01.help)};
  IF v_n <> 1 THEN RAISE EXCEPTION 'V575 postflight: câu CFG01'; END IF;
${parityChecks}

  -- Up tin: FB41 do block tự phát (V472) giữ như bộ cũ (dòng 339: không tính lượt, câu đã duyệt).
  v_new := public.aka_agent_engine_resolve_policy(${lit(FB41.code)}, NULL, 'fb_comment', 'facebook_comment_seeding_post', 'desktop', 'after_send');
  IF v_new->>'quota_effect' IS DISTINCT FROM 'no_count' OR v_new->>'log_template' IS DISTINCT FROM 'Không thấy ô bình luận dưới bài' THEN
    RAISE EXCEPTION 'V575 postflight: FB41 của Up tin đổi: %', v_new;
  END IF;

  -- NET01 khi mở trang Facebook: data về hàng đợi (anh chốt), không cộng chuỗi.
  v_new := public.aka_agent_engine_resolve_policy('err_network_offline', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'before_send');
  IF v_new->>'target_effect' IS DISTINCT FROM 'requeue' OR v_new->>'target_streak_effect' IS DISTINCT FROM 'ignore' THEN
    RAISE EXCEPTION 'V575 postflight: NET01 Facebook %', v_new;
  END IF;
${classifyChecks}

  v_text := public.aka_agent_engine_wait_note('error_limit_in_day', timestamptz '2026-11-19 00:00:00+07');
  IF v_text IS DISTINCT FROM '⏳ Đạt giới hạn trong ngày, chạy tiếp vào ngày 19/11 (LIM01)' THEN RAISE EXCEPTION 'V575 postflight: câu chờ ngày: %', v_text; END IF;
  v_text := public.aka_agent_engine_wait_note('error_limit_in_hour', timestamptz '2026-11-18 15:34:00+07');
  IF v_text IS DISTINCT FROM '⏳ Đạt giới hạn trong giờ, chạy tiếp lúc 15:34 18/11 (LIM02)' THEN RAISE EXCEPTION 'V575 postflight: câu chờ giờ: %', v_text; END IF;
  v_text := public.aka_agent_engine_wait_note(NULL, NULL);
  IF v_text IS DISTINCT FROM '⏳ Tạm chờ' THEN RAISE EXCEPTION 'V575 postflight: câu chờ không mã: %', v_text; END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ ${NAME} (chỉ tắt dòng mới, không xoá: auto_engine_outcomes có thể đã giữ mã FB46 / CFG20).
-- Desktop bản có CFG20 (cổng Zalo, đường đăng nhóm) gửi mã thẳng: sau khi gỡ, mã tắt thì DB phân loại theo luật như trước V575.
BEGIN;
SET LOCAL lock_timeout = '3s';
${WAIT_NOTE_BEFORE_SQL};
UPDATE public.auto_outcome_signal_rules SET is_active = false, updated_at = now() WHERE source = ${lit(SOURCE)} AND is_active;
UPDATE public.auto_system_settings SET value = ${lit(SIGNS_BEFORE_JSON)}, updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = '${md5(SIGNS_AFTER_JSON)}';
UPDATE public.auto_outcome_policies SET log_template = ${lit(CFG01.oldTitle)}, campaign_note_template = ${lit(CFG01.oldTitle)}
 WHERE error_code = ${lit(CFG01.code)} AND is_active AND NOT is_delete AND action_code IS NULL AND status_id IS NULL AND campaign_action_id IS NULL
   AND runtime_target IS NULL AND error_class IS NULL AND log_template = ${lit(CFG01.title)};
UPDATE public.auto_outcome_policies SET is_active = false WHERE source = ${lit(SOURCE)} AND is_active;
UPDATE public.auto_error SET customer_title = ${lit(CFG01.oldTitle)}, customer_help = NULL, updated_at = now()
 WHERE error_code = ${lit(CFG01.code)} AND customer_title = ${lit(CFG01.title)};
UPDATE public.auto_error SET is_active = false, updated_at = now() WHERE error_code IN (${lit(FB46.code)}, ${lit(CFG20.code)});
DO $post$
BEGIN
  IF md5(pg_get_functiondef('public.aka_agent_engine_wait_note(text, timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '${WAIT_NOTE_BEFORE_MD5}' THEN
    RAISE EXCEPTION 'Gỡ V575: thân aka_agent_engine_wait_note chưa về bản cũ';
  END IF;
  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '${SIGNS_BEFORE_MD5}' THEN
    RAISE EXCEPTION 'Gỡ V575: dòng facebook.error_signs chưa về bản cũ';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = ${lit(SOURCE)} AND is_active)
     OR EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = ${lit(SOURCE)} AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(CFG01.code)} AND customer_title = ${lit(CFG01.oldTitle)} AND customer_help IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = ${lit(CFG01.code)} AND is_active AND NOT is_delete
                      AND log_template = ${lit(CFG01.oldTitle)} AND campaign_note_template = ${lit(CFG01.oldTitle)}) THEN
    RAISE EXCEPTION 'Gỡ V575: dữ liệu chưa về bản cũ';
  END IF;
END $post$;
COMMIT;
`

if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations', `${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations', `${ROLLBACK_NAME}.sql`), rollback)
  console.log(`${NAME}.sql md5 ${md5(migration)}; rollback md5 ${md5(rollback)}; signs after md5 ${md5(SIGNS_AFTER_JSON)}; wait_note after md5 ${WAIT_NOTE_AFTER_MD5}`)
}

module.exports = { NAME, ROLLBACK_NAME, SOURCE, FB41, FB46, CFG01, CFG20, FB41_SIGN_CAMPAIGN_ACTIONS, SIGNS_BEFORE_MD5, SIGNS_AFTER_JSON, WAIT_NOTE_BEFORE_MD5, WAIT_NOTE_AFTER_MD5,
  POLICIES, RULES, CLASSIFY, migration, rollback }
