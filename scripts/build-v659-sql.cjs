#!/usr/bin/env node
// Sinh migration V659 (anh chốt 26/11/2026 qua hộp chọn, ca hộp thư lỗi câu 6282 cùng nhóm 6281 / 3590 / 638 / 633 / 3484): lỗi mạng / proxy
// khi mở trang Facebook, lỗi proxy Zalo. Chỉ dữ liệu, cộng một chỗ vá trong thân aka_agent_engine_report_v1 (CREATE OR REPLACE: PostgREST nạp
// lại schema, apply ngoài giờ cao điểm).
//   * Facebook trước lúc gửi: ERR_CONNECTION_* / ERR_TIMED_OUT / ERR_SOCKET_NOT_CONNECTED / ERR_TOO_MANY_RETRIES / ERR_NAME_NOT_RESOLVED /
//     ERR_ADDRESS_UNREACHABLE → NET01 (trước đây FB44: đóng data chưa đăng, cộng chuỗi).
//   * NET01 Facebook "như Zalo": data về hàng đợi, khoá mọi thao tác Facebook của tài khoản 5 phút, cộng chuỗi, 4 lần liền tạm dừng chiến
//     dịch (trước đây: không cộng chuỗi, không khoá, lượt sau chạy lại sau 0–25 giây, không bao giờ dừng).
//   * Câu NET01 (Facebook và Zalo): "Kết nối mạng bị gián đoạn, tạm ngưng tài khoản tới {until}" (Zalo trước đây "Mất kết nối tới Zalo, …").
//   * Lỗi proxy chắc chắn (câu lỗi chỉ có khi đi qua proxy) trước lúc gửi, Facebook và Zalo → NET02 cùng cách xử lý NET01, câu
//     "Proxy của tài khoản không kết nối được, tạm ngưng tài khoản tới {until}"; câu dừng NET02 nối "Kiểm tra lại proxy …" (vá report_v1).
//   * Zalo lỗi proxy lúc đang gửi → NET04 mới, xử lý y UNK01 (không gửi lại), câu "Proxy của tài khoản không kết nối được lúc đang gửi".
//     Tìm SĐT (đọc, không gửi) lúc đang chạy → NET02 như cách UNK01 đang xử lý tìm SĐT (về hàng đợi, khoá 5 phút, 4 lần dừng).
//   * Bước danh tính Page (FB06): Desktop bản sau gửi lỗi mở trang của bước này như bước mở trang (không gắn sẵn mã) nên đi theo các luật
//     trên; không cần dòng DB riêng. Bản Desktop cũ vẫn gửi thẳng mã FB06, không đổi.
//   node scripts/build-v659-sql.cjs   → migrations/migration_v659_engine_network_proxy_codes.sql + rollback
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const NAME = 'migration_v659_engine_network_proxy_codes'
const ROLLBACK_NAME = 'rollback_v659_engine_network_proxy_codes'
const SOURCE = 'v659'
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const lit = text => text == null ? 'NULL' : `'${String(text).replace(/'/g, "''")}'`
const arr = list => `ARRAY[${list.map(lit).join(', ')}]::text[]`

// Bản sao danh mục production đọc chỉ đọc 26/11/2026 (scripts/engine-v2-facebook/export-engine-catalog.cjs).
const CATALOG_FILE = path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/engine-catalog-20261126.json')
const CATALOG = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'))

const FB_ACTIONS = ['fb_post_group', 'fb_post_my_profile', 'fb_comment', 'fb_message_stranger', 'fb_message_friend', 'fb_add_friend', 'fb_like_post',
  'fb_post_page', 'fb_message_page_inbox_customer', 'fb_join_group', 'fb_group_invite']
// Như lock_action_codes của 11 dòng NET01 Zalo (V500 Q5, id 233–243).
const ZALO_ACTIONS = ['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_message_friend', 'zalo_message_group', 'zalo_add_friend', 'zalo_add_group_member',
  'zalo_join_group', 'zalo_join_group_link', 'zalo_tag_contact', 'zalo_change_alias', 'zalo_cancel_sent_friend_request']

// Câu cho khách (anh duyệt từng câu 26/11).
const TEXT = {
  net01Old: 'Mất kết nối tới Zalo, tạm ngưng tài khoản tới {until}',
  net01: 'Kết nối mạng bị gián đoạn, tạm ngưng tài khoản tới {until}',
  net02: 'Proxy của tài khoản không kết nối được, tạm ngưng tài khoản tới {until}',
  net02Help: 'Kiểm tra lại proxy của tài khoản rồi bấm Tiếp tục chiến dịch.',
  net04: 'Proxy của tài khoản không kết nối được lúc đang gửi'
}
const NET01 = 'err_network_offline'
const NET02 = 'err_proxy_failed'
const UNK01 = 'err_engine_unknown_delivery'
const FB06 = 'err_fb_identity_switch_failed'
const NET04 = { code: 'err_proxy_unknown_delivery', pub: 'NET04', cls: 'unknown_delivery', title: TEXT.net04 }

// Câu lỗi của trình duyệt (Chromium: "ERR_X (-n) loading '…'" hay "net::ERR_X") khi chưa tới được trang. LIKE: "\_" là gạch dưới thật.
const NETWORK_PATTERNS = ['ERR_CONNECTION_', 'ERR_TIMED_OUT', 'ERR_SOCKET_NOT_CONNECTED', 'ERR_TOO_MANY_RETRIES', 'ERR_NAME_NOT_RESOLVED', 'ERR_ADDRESS_UNREACHABLE']
// Chỉ câu chắc chắn là proxy (chỉ xuất hiện khi đi qua proxy; như isProxyNavigationErrorCode của Quét data, anh chốt 20/11), cộng câu của
// https-proxy-agent (Node) mà Zalo trả khi proxy ngắt trước khi trả lời CONNECT.
const PROXY_PATTERNS = ['ERR_PROXY', 'ERR_TUNNEL_CONNECTION_FAILED', 'ERR_NO_SUPPORTED_PROXIES', 'ERR_SOCKS', 'ERR_MANDATORY_PROXY_CONFIGURATION_FAILED',
  'Proxy connection ended before receiving CONNECT response']
const like = text => `%${text.replace(/_/g, '\\_')}%`

const RULES = [
  ...NETWORK_PATTERNS.map(p => ({ platform: 'facebook', action: null, phase: 'before_send', kind: 'message_like', pattern: like(p), priority: 20, code: NET01,
    note: `[anh chốt 26/11] ${p} khi mở trang Facebook trước lúc gửi → NET01 (trước đây FB44).` })),
  ...['facebook', 'zalo'].flatMap(platform => PROXY_PATTERNS.map(p => ({ platform, action: null, phase: 'before_send', kind: 'message_like', pattern: like(p),
    priority: 10, code: NET02, note: `[anh chốt 26/11] Lỗi proxy chắc chắn (${p}) trước lúc gửi → NET02.` }))),
  ...PROXY_PATTERNS.map(p => ({ platform: 'zalo', action: 'zalo_find_phone_user', phase: 'in_flight', kind: 'message_like', pattern: like(p), priority: 10,
    code: NET02, note: `[anh chốt 26/11] Tìm SĐT (đọc, không gửi) lỗi proxy (${p}) → NET02 như UNK01 đang xử lý tìm SĐT.` })),
  ...PROXY_PATTERNS.map(p => ({ platform: 'zalo', action: null, phase: 'in_flight', kind: 'message_like', pattern: like(p), priority: 10, code: NET04.code,
    note: `[anh chốt 26/11] Lỗi proxy chắc chắn (${p}) lúc đang gửi → NET04 (xử lý y UNK01, không gửi lại).` }))
]
const ruleValues = RULES.map(r => `  (${lit(r.platform)}, ${lit(r.action)}, ${lit(r.phase)}, ${lit(r.kind)}, ${lit(r.pattern)}, ${r.priority}, ${lit(r.code)}, ${lit(r.note)}, ${lit(SOURCE)}, true)`).join(',\n')

// Dòng chính sách "như Zalo": y 11 dòng NET01 Zalo (V500 Q5, id 233–243), đổi mã / thao tác / danh sách khoá / câu.
const POLICY_COLUMNS = ['error_code', 'action_code', 'detail_mode', 'log_template', 'quota_effect', 'target_streak_effect', 'streak_threshold', 'target_effect',
  'remaining_steps', 'lock_action_codes', 'lock_mode', 'lock_minutes', 'run_effect', 'pace_mode', 'campaign_effect', 'description', 'source']
const likeZalo = (code, action, locks, log, description) => ({ error_code: code, action_code: action, detail_mode: 'suppress', log_template: log,
  quota_effect: 'no_count', target_streak_effect: 'increment', streak_threshold: 4, target_effect: 'requeue', remaining_steps: 'skip',
  lock_action_codes: locks, lock_mode: 'fixed_minutes', lock_minutes: 5, run_effect: 'end_unit', pace_mode: 'none', campaign_effect: 'pause',
  description, source: SOURCE })
const POLICIES = [
  ...FB_ACTIONS.map(a => likeZalo(NET01, a, FB_ACTIONS, TEXT.net01,
    '[anh chốt 26/11] NET01 Facebook như Zalo: data về hàng đợi, khoá thao tác Facebook của tài khoản 5 phút, 4 lần liền tạm dừng chiến dịch.')),
  ...FB_ACTIONS.map(a => likeZalo(NET02, a, FB_ACTIONS, TEXT.net02,
    '[anh chốt 26/11] NET02 Facebook (proxy chắc chắn): cách xử lý như NET01, câu nói proxy.')),
  ...ZALO_ACTIONS.map(a => likeZalo(NET02, a, ZALO_ACTIONS, TEXT.net02,
    '[anh chốt 26/11] NET02 Zalo (proxy chắc chắn, trước đây NET01): cách xử lý như NET01 Zalo, câu nói proxy.'))
]
const policyValues = POLICIES.map(p => `  (${POLICY_COLUMNS.map(col => {
  const v = p[col]
  if (v === undefined || v === null) return 'NULL'
  if (Array.isArray(v)) return arr(v)
  return typeof v === 'number' ? String(v) : lit(v)
}).join(', ')})`).join(',\n')

// NET04: chép mọi dòng UNK01 áp cho Zalo (trừ tìm SĐT, đi NET02), mọi cột quyết định giữ nguyên, chỉ đổi mã / nguồn / mô tả.
const COPY_COLUMNS = ['error_class', 'status_id', 'action_code', 'campaign_action_id', 'runtime_target', 'detail_mode', 'detail_status_id', 'sub_status_id',
  'log_template', 'campaign_note_template', 'quota_effect', 'target_streak_effect', 'streak_threshold', 'target_effect', 'requeue_after_minutes',
  'remaining_steps', 'lock_action_codes', 'lock_mode', 'lock_minutes', 'lock_days', 'lock_time', 'run_effect', 'pace_mode', 'pace_seconds',
  'campaign_effect', 'campaign_hold_minutes', 'account_effect', 'login_effect', 'streak_after_delivery', 'target_check_enabled', 'target_check_days']
const UNK01_COPY_WHERE = `error_code = '${UNK01}' AND is_active AND NOT is_delete
   AND (action_code IS NULL OR action_code LIKE 'zalo\\_%') AND action_code IS DISTINCT FROM 'zalo_find_phone_user'`
const policyRows = () => {
  const t = CATALOG.tables.auto_outcome_policies
  return t.rows.map(r => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])))
}
const UNK01_COPY = policyRows().filter(p => p.error_code === UNK01 && p.is_active && !p.is_delete
  && (p.action_code === null || p.action_code.startsWith('zalo_')) && p.action_code !== 'zalo_find_phone_user')
// Vân tay các dòng UNK01 được chép (cùng cách tính trong SQL: jsonb các cột quyết định, theo id).
const UNK01_COPY_IDS = UNK01_COPY.map(p => p.id)
if (UNK01_COPY_IDS.join(',') !== '107,202,203,204,205,206') throw new Error(`Dòng UNK01 khác bản đọc 26/11: ${UNK01_COPY_IDS}`)
const ZALO_NET01 = policyRows().filter(p => p.error_code === NET01 && p.is_active && !p.is_delete && ZALO_ACTIONS.includes(p.action_code))
if (ZALO_NET01.length !== 11 || ZALO_NET01.some(p => p.log_template !== TEXT.net01Old || p.lock_minutes !== 5 || p.streak_threshold !== 4
  || JSON.stringify(p.lock_action_codes) !== JSON.stringify(ZALO_ACTIONS))) throw new Error('11 dòng NET01 Zalo khác bản đọc 26/11')

// Vá aka_agent_engine_report_v1: câu dừng (ngưỡng) nối câu bước tiếp theo của NET02 như mã FB (V558).
const REPORT_SIG = 'public.aka_agent_engine_report_v1(bigint, uuid, jsonb, boolean, boolean)'
const REPORT_OLD = `        -- V558: câu bước tiếp theo của mã Facebook (anh duyệt 17/11, Q23) nối sau câu dừng; mã khác (Zalo, SYS) giữ nguyên câu cũ.
        || coalesce('. ' || nullif(btrim((SELECT e.customer_help FROM public.auto_error e
                                          WHERE e.error_code = v_last_error_code AND e.public_code LIKE 'FB%')), ''), '');`
const REPORT_NEW = `        -- V558: câu bước tiếp theo của mã Facebook (anh duyệt 17/11, Q23) nối sau câu dừng; mã khác (Zalo, SYS) giữ nguyên câu cũ.
        -- V659: NET02 (proxy của tài khoản, Facebook lẫn Zalo) cũng nối câu bước tiếp theo (anh chốt 26/11).
        || coalesce('. ' || nullif(btrim((SELECT e.customer_help FROM public.auto_error e
                                          WHERE e.error_code = v_last_error_code
                                            AND (e.public_code LIKE 'FB%' OR e.error_code = '${NET02}'))), ''), '');`
const reportBefore = CATALOG.functions.find(f => f.name === 'aka_agent_engine_report_v1')
const REPORT_BEFORE_MD5 = '78ed8f80c4ff7de3cae3eb3e36bb6e1b'
if (reportBefore.md5 !== REPORT_BEFORE_MD5 || md5(reportBefore.def) !== REPORT_BEFORE_MD5) throw new Error('Thân report_v1 trong bản sao khác bản đọc 26/11')
if (reportBefore.def.split(REPORT_OLD).length !== 2) throw new Error('Đoạn vá report_v1 không còn đúng một chỗ')
const REPORT_AFTER_MD5 = md5(reportBefore.def.replace(REPORT_OLD, REPORT_NEW))
const reportPatchSql = (from, to, beforeMd5, afterMd5, label) => `DO $${label}$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('${REPORT_SIG}'::regprocedure);
  IF ${beforeMd5 ? `md5(v_def) IS DISTINCT FROM '${beforeMd5}'` : 'false'} THEN RAISE EXCEPTION 'V659: aka_agent_engine_report_v1 đã đổi (md5 %)', md5(v_def); END IF;
  IF array_length(string_to_array(v_def, ${lit(from)}), 1) <> 2 THEN RAISE EXCEPTION 'V659: đoạn vá report_v1 không đúng một chỗ'; END IF;
  v_new := replace(v_def, ${lit(from)}, ${lit(to)});
  IF ${afterMd5 ? `md5(v_new) IS DISTINCT FROM '${afterMd5}'` : 'false'} THEN RAISE EXCEPTION 'V659: thân report_v1 sau vá lệch (md5 %)', md5(v_new); END IF;
  EXECUTE v_new;
  IF ${afterMd5 ? `md5(pg_get_functiondef('${REPORT_SIG}'::regprocedure)) IS DISTINCT FROM '${afterMd5}'` : 'false'} THEN
    RAISE EXCEPTION 'V659: thân report_v1 sau khi tạo lại lệch';
  END IF;
END $${label}$;`

/** Phần dữ liệu (không kiểm trước / sau): dùng nguyên văn trong migration và trong bài kiểm Desktop (DB thử không giống production từng dòng). */
const coreSql = `INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', ${lit(NET04.code)}, ${lit(NET04.title)}, ${lit(`V659 (engine v2): ${NET04.title}; xử lý y UNK01 (không gửi lại).`)}, NULL, NULL,
  '{}', false, false, 'fixed_minutes', '{}', '{}', true, false, ${lit(NET04.pub)}, ${lit(NET04.cls)}, ${lit(NET04.title)}, NULL);

-- NET02: câu bước tiếp theo nối sau câu dừng (report_v1 vá bên dưới). Bộ cũ đọc noti_*, giữ nguyên.
UPDATE public.auto_error SET customer_help = ${lit(TEXT.net02Help)}, updated_at = now() WHERE error_code = ${lit(NET02)} AND customer_help IS NULL;

INSERT INTO public.auto_outcome_policies (${POLICY_COLUMNS.join(', ')}) VALUES
${policyValues};

INSERT INTO public.auto_outcome_policies (error_code, ${COPY_COLUMNS.join(', ')}, description, source)
SELECT ${lit(NET04.code)}, ${COPY_COLUMNS.join(', ')},
       '[anh chốt 26/11] NET04 (proxy lúc đang gửi, Zalo): chép dòng UNK01 ' || id || ', xử lý y UNK01.', ${lit(SOURCE)}
  FROM public.auto_outcome_policies WHERE ${UNK01_COPY_WHERE} ORDER BY id;

-- NET01 Zalo: chỉ đổi câu (anh chốt dùng chung câu với Facebook).
UPDATE public.auto_outcome_policies SET log_template = ${lit(TEXT.net01)}
 WHERE error_code = ${lit(NET01)} AND is_active AND NOT is_delete AND action_code = ANY (${arr(ZALO_ACTIONS)}) AND log_template = ${lit(TEXT.net01Old)};

INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, note, source, is_active) VALUES
${ruleValues};`

// Tín hiệu mẫu (dạng như production 19–25/11, đã bỏ phần nhận dạng nhóm / người).
const CLASSIFY = [
  ['facebook', 'fb_post_group', 'before_send', { kind: 'block', code: 'navigate:www.facebook.com/groups/1', message: "ERR_CONNECTION_TIMED_OUT (-118) loading 'https://www.facebook.com/groups/1'" }, NET01],
  ['facebook', 'fb_add_friend', 'before_send', { kind: 'block', code: 'navigate:www.facebook.com/profile.php', message: "ERR_CONNECTION_TIMED_OUT (-118) loading 'https://www.facebook.com/profile.php?id=1'" }, NET01],
  ['facebook', 'fb_post_group', 'before_send', { kind: 'block', code: 'navigate:www.facebook.com/groups/1', message: "ERR_CONNECTION_RESET (-101) loading 'https://www.facebook.com/groups/1'" }, NET01],
  ['facebook', 'fb_post_group', 'before_send', { kind: 'block', code: 'navigate:www.facebook.com/groups/1', message: "ERR_TIMED_OUT (-7) loading 'https://www.facebook.com/groups/1'" }, NET01],
  ['facebook', 'fb_post_group', 'before_send', { kind: 'block', code: 'navigate:www.facebook.com/groups/1', message: "ERR_SOCKET_NOT_CONNECTED (-15) loading 'https://www.facebook.com/groups/1'" }, NET01],
  ['facebook', 'fb_comment', 'before_send', { kind: 'exception', message: 'net::ERR_NAME_NOT_RESOLVED' }, NET01],
  ['facebook', 'fb_post_group', 'before_send', { kind: 'block', code: 'navigate:www.facebook.com/groups/1', message: "ERR_NETWORK_IO_SUSPENDED (-331) loading 'https://www.facebook.com/groups/1'" }, NET01],
  ['facebook', 'fb_post_group', 'before_send', { kind: 'block', code: 'navigate:www.facebook.com/groups/1', message: "ERR_PROXY_CONNECTION_FAILED (-130) loading 'https://www.facebook.com/groups/1'" }, NET02],
  ['facebook', 'fb_post_group', 'before_send', { kind: 'block', code: 'navigate:www.facebook.com/groups/1', message: "ERR_TUNNEL_CONNECTION_FAILED (-111) loading 'https://www.facebook.com/groups/1'" }, NET02],
  // Bước danh tính lỗi lúc mở trang chủ: Desktop bản sau gửi như bước mở trang (không mã).
  ['facebook', 'fb_post_group', 'before_send', { kind: 'block', code: 'navigate:www.facebook.com', message: "ERR_PROXY_CONNECTION_FAILED (-130) loading 'https://www.facebook.com/'" }, NET02],
  ['facebook', 'fb_post_group', 'before_send', { kind: 'block', code: 'navigate:www.facebook.com', message: "ERR_TOO_MANY_RETRIES (-375) loading 'https://www.facebook.com/'" }, NET01],
  // Lỗi trên trang ở bước danh tính, và mọi lỗi của bản Desktop cũ: gửi thẳng mã FB06, không đổi.
  ['facebook', 'fb_post_group', 'before_send', { kind: 'block', code: 'identity_switch', errorCode: FB06, message: 'Không tìm thấy nút mở menu profile/page hiện tại' }, FB06],
  ['facebook', 'fb_post_group', 'before_send', { kind: 'block', code: 'identity_switch', errorCode: FB06, message: "ERR_PROXY_CONNECTION_FAILED (-130) loading 'https://www.facebook.com/'" }, FB06],
  ['facebook', 'fb_post_group', 'before_send', { kind: 'block', code: 'wait:fb_post_button', message: 'waitForSelector timeout: //div' }, 'err_engine_fb_ui_not_ready'],
  ['facebook', 'fb_post_group', 'before_send', { kind: 'block', code: 'navigate:www.facebook.com/groups/1', message: "ERR_ABORTED (-3) loading 'https://www.facebook.com/groups/1'" }, 'err_engine_fb_ui_not_ready'],
  ['zalo', 'zalo_find_phone_user', 'before_send', { kind: 'message_like', message: 'net::ERR_TUNNEL_CONNECTION_FAILED' }, NET02],
  ['zalo', 'zalo_find_phone_user', 'before_send', { kind: 'message_like', message: 'net::ERR_PROXY_CONNECTION_FAILED' }, NET02],
  ['zalo', 'zalo_message_stranger', 'before_send', { kind: 'message_like', message: 'fetch failed (read ECONNRESET)' }, NET01],
  ['zalo', 'zalo_message_stranger', 'in_flight', { kind: 'message_like', message: 'net::ERR_TUNNEL_CONNECTION_FAILED' }, NET04.code],
  ['zalo', 'zalo_change_alias', 'in_flight', { kind: 'message_like', message: 'net::ERR_TUNNEL_CONNECTION_FAILED' }, NET04.code],
  ['zalo', 'zalo_add_friend', 'in_flight', { kind: 'message_like', message: 'request to https://tt-friend-wpa.chat.zalo.me/api/friend/sendreq failed, reason: Proxy connection ended before receiving CONNECT response' }, NET04.code],
  ['zalo', 'zalo_find_phone_user', 'in_flight', { kind: 'message_like', message: 'net::ERR_TUNNEL_CONNECTION_FAILED' }, NET02],
  ['zalo', 'zalo_message_stranger', 'in_flight', { kind: 'message_like', message: 'fetch failed (read ECONNRESET)' }, UNK01]
]
// Lỗi mạng / proxy lúc đang gửi ở Facebook giữ như hôm nay (không ra NET01 / NET02 / NET04).
const CLASSIFY_UNCHANGED_IN_FLIGHT = [
  ['facebook', 'fb_post_group', 'in_flight', { kind: 'block', code: 'navigate:www.facebook.com/groups/1', message: "ERR_CONNECTION_RESET (-101) loading 'https://www.facebook.com/groups/1'" }],
  ['facebook', 'fb_post_group', 'in_flight', { kind: 'block', code: 'navigate:www.facebook.com/groups/1', message: "ERR_PROXY_CONNECTION_FAILED (-130) loading 'https://www.facebook.com/groups/1'" }]
]
// Phép kiểm sau apply chạy theo vòng lặp trên mảng JSON (gọn, đọc được).
const CLASSIFY_JSON = JSON.stringify(CLASSIFY.map(([platform, action, phase, signal, expected]) => ({ platform, action, phase, signal, expected })))
const CLASSIFY_UNCHANGED_JSON = JSON.stringify(CLASSIFY_UNCHANGED_IN_FLIGHT.map(([platform, action, phase, signal]) => ({ platform, action, phase, signal })))
// Chính sách gộp phải ra "như Zalo" cho NET01 / NET02 ở mọi thao tác × nơi chạy; NET04 y UNK01 ở mọi thao tác Zalo (trừ tìm SĐT) × nơi chạy × pha.
// Facebook (không có dòng chặn theo thao tác đổi chuỗi khi không nêu loại chiến dịch): giá trị cố định như Zalo. Zalo: NET02 y NET01 Zalo
// (gắn tag / đổi tên gợi nhớ có dòng chặn không cộng chuỗi, như NET01 hôm nay).
const LIKE_ZALO_JSON = JSON.stringify([[NET01, FB_ACTIONS, TEXT.net01], [NET02, FB_ACTIONS, TEXT.net02]].map(([code, actions, log]) => ({ code, actions, log })))
const ZALO_PARITY_JSON = JSON.stringify(ZALO_ACTIONS)
const NET04_PARITY_JSON = JSON.stringify(ZALO_ACTIONS.filter(a => a !== 'zalo_find_phone_user')
  .flatMap(action => ['desktop', 'fly'].flatMap(rt => ['in_flight', 'before_send', 'after_send'].map(phase => ({ action, rt, phase })))))
const PARITY_DROP = `- 'policy_ids' - 'revisions' - 'error_class' - 'log_template' - 'campaign_note_template'`
const postChecks = `
  -- Mỗi nhóm: mọi thao tác trong nhóm × Desktop / Fly; danh sách khoá = cả nhóm thao tác.
  FOR v_c, v_text, v_rt IN SELECT x, a, rt FROM jsonb_array_elements(${lit(LIKE_ZALO_JSON)}::jsonb) x,
      jsonb_array_elements_text(x->'actions') a, unnest(ARRAY['desktop', 'fly']) rt LOOP
    v_new := public.aka_agent_engine_resolve_policy(v_c->>'code', NULL, v_text, NULL, v_rt, 'before_send');
    IF v_new->>'target_effect' IS DISTINCT FROM 'requeue' OR v_new->>'target_streak_effect' IS DISTINCT FROM 'increment'
       OR (v_new->>'streak_threshold')::int IS DISTINCT FROM 4 OR v_new->>'campaign_effect' IS DISTINCT FROM 'pause'
       OR (v_new->>'lock_minutes')::int IS DISTINCT FROM 5 OR v_new->'lock_action_codes' IS DISTINCT FROM v_c->'actions'
       OR v_new->>'log_template' IS DISTINCT FROM v_c->>'log' OR v_new->>'quota_effect' IS DISTINCT FROM 'no_count' THEN
      RAISE EXCEPTION 'V659 postflight: % % % ra %', v_c->>'code', v_text, v_rt, v_new;
    END IF;
  END LOOP;
  FOR v_text, v_rt, v_c IN SELECT a, rt, to_jsonb(ph) FROM jsonb_array_elements_text(${lit(ZALO_PARITY_JSON)}::jsonb) a, unnest(ARRAY['desktop', 'fly']) rt,
      unnest(ARRAY['before_send', 'in_flight', 'after_send']) ph LOOP
    v_new := public.aka_agent_engine_resolve_policy(${lit(NET02)}, NULL, v_text, NULL, v_rt, v_c #>> '{}');
    v_old := public.aka_agent_engine_resolve_policy(${lit(NET01)}, NULL, v_text, NULL, v_rt, v_c #>> '{}');
    IF (v_new ${PARITY_DROP}) IS DISTINCT FROM (v_old ${PARITY_DROP}) OR v_new->>'log_template' IS DISTINCT FROM ${lit(TEXT.net02)}
       OR v_old->>'log_template' IS DISTINCT FROM ${lit(TEXT.net01)} THEN
      RAISE EXCEPTION 'V659 postflight: NET02 Zalo % % % khác NET01: % / %', v_text, v_rt, v_c, v_new, v_old;
    END IF;
  END LOOP;
  FOR v_c IN SELECT x FROM jsonb_array_elements(${lit(NET04_PARITY_JSON)}::jsonb) x LOOP
    v_new := public.aka_agent_engine_resolve_policy(${lit(NET04.code)}, NULL, v_c->>'action', NULL, v_c->>'rt', v_c->>'phase');
    v_old := public.aka_agent_engine_resolve_policy(${lit(UNK01)}, NULL, v_c->>'action', NULL, v_c->>'rt', v_c->>'phase');
    IF (v_new ${PARITY_DROP}) IS DISTINCT FROM (v_old ${PARITY_DROP}) OR v_new->>'error_class' IS DISTINCT FROM 'unknown_delivery' THEN
      RAISE EXCEPTION 'V659 postflight: NET04 % khác UNK01: % / %', v_c, v_new, v_old;
    END IF;
  END LOOP;
  FOR v_c IN SELECT x FROM jsonb_array_elements(${lit(CLASSIFY_JSON)}::jsonb) x LOOP
    SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal(v_c->>'platform', v_c->>'action', v_c->>'phase', v_c->'signal') c;
    IF v_text IS DISTINCT FROM v_c->>'expected' THEN RAISE EXCEPTION 'V659 postflight: tín hiệu % ra %', v_c, v_text; END IF;
  END LOOP;
  -- Lỗi mạng / proxy lúc đang gửi ở Facebook giữ như hôm nay.
  FOR v_c IN SELECT x FROM jsonb_array_elements(${lit(CLASSIFY_UNCHANGED_JSON)}::jsonb) x LOOP
    SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal(v_c->>'platform', v_c->>'action', v_c->>'phase', v_c->'signal') c;
    IF v_text IN (${lit(NET01)}, ${lit(NET02)}, ${lit(NET04.code)}) THEN RAISE EXCEPTION 'V659 postflight: tín hiệu % lúc đang gửi ra %', v_c, v_text; END IF;
  END LOOP;`

const migration = `-- ${NAME}: lỗi mạng / proxy khi mở trang Facebook, lỗi proxy Zalo. Anh chốt 26/11/2026 qua hộp chọn (ca hộp thư lỗi câu 6282, cùng nhóm
-- 6281 / 3590 / 638 / 633 / 3484). Sinh bằng scripts/build-v659-sql.cjs từ bản sao danh mục production đọc 26/11, không sửa tay.
--   * Facebook trước lúc gửi: ERR_CONNECTION_* / ERR_TIMED_OUT / ERR_SOCKET_NOT_CONNECTED / ERR_TOO_MANY_RETRIES / ERR_NAME_NOT_RESOLVED /
--     ERR_ADDRESS_UNREACHABLE → NET01 (trước đây FB44: đóng data chưa đăng, cộng chuỗi).
--   * NET01 Facebook như Zalo (V500 Q5): data về hàng đợi, khoá thao tác Facebook của tài khoản 5 phút, cộng chuỗi, 4 lần liền tạm dừng.
--   * Câu NET01 Facebook và Zalo: "${TEXT.net01}".
--   * Lỗi proxy chắc chắn trước lúc gửi (Facebook, Zalo) → NET02 như NET01, câu "${TEXT.net02}"; câu dừng
--     NET02 nối "${TEXT.net02Help}" (vá aka_agent_engine_report_v1).
--   * Zalo lỗi proxy lúc đang gửi → NET04 mới, y UNK01; tìm SĐT lỗi proxy lúc đang chạy → NET02.
--   * Bước danh tính Page: Desktop bản sau gửi lỗi mở trang của bước này như bước mở trang, nên đi theo luật trên (không cần dòng riêng).
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $pre$
DECLARE v_n int;
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v659_%') THEN
    RAISE EXCEPTION 'V659: sổ migration đã có migration_v659_%%, không chạy lại';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(NET04.code)} OR public_code = ${lit(NET04.pub)}) THEN
    RAISE EXCEPTION 'V659: đã có mã NET04';
  END IF;
  IF (SELECT count(*) FROM public.auto_error WHERE is_active AND NOT is_delete AND (error_code, public_code) IN
      ((${lit(NET01)}, 'NET01'), (${lit(NET02)}, 'NET02'), (${lit(UNK01)}, 'UNK01'), (${lit(FB06)}, 'FB06'))) <> 4 THEN
    RAISE EXCEPTION 'V659: thiếu mã NET01 / NET02 / UNK01 / FB06';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(NET02)} AND customer_help IS NULL) THEN
    RAISE EXCEPTION 'V659: câu bước tiếp theo của NET02 đã có';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE error_code = ${lit(NET01)} AND is_active AND NOT is_delete
    AND action_code = ANY (${arr(ZALO_ACTIONS)}) AND log_template = ${lit(TEXT.net01Old)} AND lock_minutes = 5 AND streak_threshold = 4
    AND lock_action_codes = ${arr(ZALO_ACTIONS)} AND campaign_effect = 'pause' AND target_effect = 'requeue';
  IF v_n <> ${ZALO_ACTIONS.length} THEN RAISE EXCEPTION 'V659: % dòng NET01 Zalo đúng bản đọc 26/11 (cần ${ZALO_ACTIONS.length})', v_n; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE is_active AND NOT is_delete AND (
       (error_code IN (${lit(NET01)}, ${lit(NET02)}) AND action_code LIKE 'fb\\_%') OR (error_code = ${lit(NET02)} AND action_code LIKE 'zalo\\_%'))) THEN
    RAISE EXCEPTION 'V659: đã có chính sách NET01 / NET02 theo thao tác Facebook hoặc NET02 theo thao tác Zalo';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE ${UNK01_COPY_WHERE} AND id = ANY (ARRAY[${UNK01_COPY_IDS.join(', ')}]::bigint[]);
  IF v_n <> ${UNK01_COPY_IDS.length} OR (SELECT count(*) FROM public.auto_outcome_policies WHERE ${UNK01_COPY_WHERE}) <> ${UNK01_COPY_IDS.length} THEN
    RAISE EXCEPTION 'V659: dòng UNK01 để chép cho NET04 khác bản đọc 26/11';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_account_actions WHERE is_active AND NOT is_delete AND code = ANY (${arr([...FB_ACTIONS, ...ZALO_ACTIONS])});
  IF v_n <> ${FB_ACTIONS.length + ZALO_ACTIONS.length} THEN RAISE EXCEPTION 'V659: % thao tác để khoá (cần ${FB_ACTIONS.length + ZALO_ACTIONS.length})', v_n; END IF;
  IF md5(pg_get_functiondef('${REPORT_SIG}'::regprocedure)) IS DISTINCT FROM '${REPORT_BEFORE_MD5}' THEN
    RAISE EXCEPTION 'V659: aka_agent_engine_report_v1 đã đổi';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = ${lit(SOURCE)})
     OR EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = ${lit(SOURCE)}) THEN
    RAISE EXCEPTION 'V659: đã có dòng nguồn ${SOURCE}';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE is_active AND (
       signal_kind = 'message_like' AND pattern ILIKE ANY (${arr([...NETWORK_PATTERNS, ...PROXY_PATTERNS].map(like))}))) THEN
    RAISE EXCEPTION 'V659: đã có luật trùng mẫu mới';
  END IF;
END $pre$;

${coreSql}

${reportPatchSql(REPORT_OLD, REPORT_NEW, REPORT_BEFORE_MD5, REPORT_AFTER_MD5, 'patch')}

DO $post$
DECLARE v_new jsonb; v_old jsonb; v_c jsonb; v_text text; v_rt text; v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.auto_outcome_signal_rules WHERE source = ${lit(SOURCE)} AND is_active;
  IF v_n <> ${RULES.length} THEN RAISE EXCEPTION 'V659 postflight: % luật mới', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE source = ${lit(SOURCE)} AND is_active AND NOT is_delete;
  IF v_n <> ${POLICIES.length + UNK01_COPY_IDS.length} THEN RAISE EXCEPTION 'V659 postflight: % dòng chính sách mới', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE error_code = ${lit(NET01)} AND is_active AND NOT is_delete AND log_template = ${lit(TEXT.net01Old)};
  IF v_n <> 0 THEN RAISE EXCEPTION 'V659 postflight: còn % dòng NET01 câu cũ', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_error WHERE error_code = ${lit(NET02)} AND customer_help = ${lit(TEXT.net02Help)};
  IF v_n <> 1 THEN RAISE EXCEPTION 'V659 postflight: câu bước tiếp theo NET02'; END IF;
${postChecks}

  v_text := public.aka_agent_engine_wait_note(${lit(NET02)}, timestamptz '2026-11-26 10:05:00+07');
  IF v_text IS DISTINCT FROM '⏳ Proxy của tài khoản không kết nối được, chạy tiếp lúc 10:05 26/11 (NET02)' THEN
    RAISE EXCEPTION 'V659 postflight: câu chờ NET02: %', v_text;
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ ${NAME} (chỉ tắt dòng mới, không xoá: auto_engine_outcomes có thể đã giữ mã NET04).
-- Desktop bản sau gửi lỗi mở trang ở bước danh tính như bước mở trang: sau khi gỡ, lỗi đó ra FB44 như bước mở trang hôm nay (không còn FB06).
BEGIN;
SET LOCAL lock_timeout = '3s';
${reportPatchSql(REPORT_NEW, REPORT_OLD, REPORT_AFTER_MD5, REPORT_BEFORE_MD5, 'unpatch')}
UPDATE public.auto_outcome_signal_rules SET is_active = false, updated_at = now() WHERE source = ${lit(SOURCE)} AND is_active;
UPDATE public.auto_outcome_policies SET log_template = ${lit(TEXT.net01Old)}
 WHERE error_code = ${lit(NET01)} AND is_active AND NOT is_delete AND action_code = ANY (${arr(ZALO_ACTIONS)}) AND log_template = ${lit(TEXT.net01)}
   AND source IS DISTINCT FROM ${lit(SOURCE)};
UPDATE public.auto_outcome_policies SET is_active = false WHERE source = ${lit(SOURCE)} AND is_active;
UPDATE public.auto_error SET customer_help = NULL, updated_at = now() WHERE error_code = ${lit(NET02)} AND customer_help = ${lit(TEXT.net02Help)};
UPDATE public.auto_error SET is_active = false, updated_at = now() WHERE error_code = ${lit(NET04.code)};
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = ${lit(SOURCE)} AND is_active)
     OR EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = ${lit(SOURCE)} AND is_active)
     OR (SELECT count(*) FROM public.auto_outcome_policies WHERE error_code = ${lit(NET01)} AND is_active AND NOT is_delete
           AND action_code = ANY (${arr(ZALO_ACTIONS)}) AND log_template = ${lit(TEXT.net01Old)}) <> ${ZALO_ACTIONS.length}
     OR NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(NET02)} AND customer_help IS NULL) THEN
    RAISE EXCEPTION 'Gỡ V659: dữ liệu chưa về bản cũ';
  END IF;
END $post$;
COMMIT;
`

if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations', `${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations', `${ROLLBACK_NAME}.sql`), rollback)
  console.log(`${NAME}.sql md5 ${md5(migration)}; rollback md5 ${md5(rollback)}; report_v1 ${REPORT_BEFORE_MD5} → ${REPORT_AFTER_MD5}; ${RULES.length} luật, ${POLICIES.length + UNK01_COPY_IDS.length} chính sách`)
}

module.exports = { NAME, ROLLBACK_NAME, SOURCE, TEXT, NET01, NET02, NET04, UNK01, FB06, FB_ACTIONS, ZALO_ACTIONS, NETWORK_PATTERNS, PROXY_PATTERNS, RULES, POLICIES,
  UNK01_COPY_IDS, CLASSIFY, CLASSIFY_UNCHANGED_IN_FLIGHT, REPORT_SIG, REPORT_OLD, REPORT_NEW, REPORT_BEFORE_MD5, REPORT_AFTER_MD5, coreSql, reportPatchSql,
  migration, rollback }
