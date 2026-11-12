// Sinh migration V500: chính sách xử lý lỗi Zalo theo bảng duyệt đầy đủ, ĐÃ ĐƯỢC ANH DUYỆT TỪNG CÂU ngày 11/11/2026
// (docs/CAMPAIGN_OUTCOME_ENGINE_ZALO_FULL_REVIEW.md, mục "Quyết định đã chốt"). Cần V499 (nhớ mục tiêu theo tài khoản).
//
// CHỈ DỮ LIỆU, CHỈ engine v2 đọc (auto_outcome_*). Bộ chạy cũ (Desktop/VPS, chat-sync) đọc auto_error như cũ nên không đổi:
// dòng auto_error mới đều là 'engine v2' và không có zalo_error_codes (bộ kiểm lúc chạy của bản cũ bỏ qua).
//
// Cách ghi: không sửa dòng seed V495. Mỗi quyết định là các dòng chính sách RIÊNG theo (mã lỗi, thao tác[, nơi chạy]),
// source 'v500_review', chỉ ghi đè đúng trường cần đổi (trường NULL = kế thừa seed). Gỡ = xoá các dòng source 'v500_review'.
// Mọi con số (số phút khoá, số lần liền thì tạm dừng, số ngày nhớ) là cột của auto_outcome_policies: sửa bằng SQL, có lịch sử.
// Chạy: node scripts/build-v500-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')

const ZALO_ACTIONS = ['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_message_friend', 'zalo_message_group', 'zalo_add_friend',
  'zalo_add_group_member', 'zalo_join_group', 'zalo_join_group_link', 'zalo_tag_contact', 'zalo_change_alias', 'zalo_cancel_sent_friend_request']
const MESSAGE_ACTIONS = ['zalo_message_stranger', 'zalo_message_friend', 'zalo_message_group']

// [Q1] Không nghỉ khi data hỏng do người nhận/data (kể cả tra số không tồn tại). Nghỉ của data = mức nặng nhất trong các bước.
const NO_PACE = { pace_mode: 'none' }
// [Q6] Nhớ 30 ngày, chỉ theo đúng tài khoản đã gặp lỗi (V499).
const REMEMBER = { remember_target_days: 30 }
// [Q4] Mã do TÀI KHOẢN (Zalo hạn chế / hết lượt), không do data: data về "chờ xử lý" (khoá thao tác có sẵn giãn nhịp),
// bỏ bước còn lại của lần đó, không trừ hạn mức; 3 lần liền vẫn lỗi thì tạm dừng chiến dịch, data vẫn ở chờ xử lý.
const ACCOUNT_CAUSED = { quota_effect: 'no_count', target_effect: 'requeue', remaining_steps: 'skip', target_streak_effect: 'increment',
  streak_threshold: 3, campaign_effect: 'pause' }
// [Q5] Lỗi mạng / máy gửi chưa sẵn sàng (không do data): không ghi lịch sử, data về "chờ xử lý" (không bao giờ đốt), khoá
// mọi thao tác Zalo của TÀI KHOẢN 5 phút (mọi chiến dịch của tài khoản đó cùng chờ, kể cả bộ cũ); 4 lần liền thì tạm dừng.
const NETWORK = { detail_mode: 'suppress', quota_effect: 'no_count', target_effect: 'requeue', remaining_steps: 'skip',
  lock_action_codes: ZALO_ACTIONS, lock_mode: 'fixed_minutes', lock_minutes: 5, target_streak_effect: 'increment', streak_threshold: 4,
  campaign_effect: 'pause', run_effect: 'end_unit', pace_mode: 'none' }

// Mã mới chỉ cho engine v2 (error_type 'engine v2', không có zalo_error_codes). [mã, mã công khai, nhóm, tên, câu cho khách, cách xử lý]
const NEW_CODES = [
  ['err_engine_zalo_not_group_member', 'Z164', 'content_config', 'Tài khoản không ở trong nhóm đích',
    'Tài khoản không phải thành viên của nhóm đích', 'Cho tài khoản vào nhóm rồi chạy tiếp chiến dịch.'],
  ['err_engine_zalo_group_member_limit', 'Z183', 'content_config', 'Nhóm đã đủ số thành viên tối đa',
    'Nhóm đã đủ số thành viên tối đa', 'Chọn nhóm khác hoặc bớt thành viên rồi chạy tiếp.'],
  ['err_engine_zalo_group_full', 'Z172', 'target_temporary', 'Nhóm đang đầy',
    'Nhóm đang đầy, chưa vào được', 'Nhóm có thể có chỗ khi có người rời; chạy lại sau.'],
  ['err_engine_zalo_join_group_day_limit', 'Z299', 'quota', 'Đã tham gia quá nhiều nhóm trong ngày',
    'Tài khoản đã tham gia quá nhiều nhóm hôm nay; chạy tiếp lúc {until}', 'Hệ thống tự chạy tiếp sang ngày mới.'],
  ['err_engine_zalo_cancel_friend_day_limit', 'Z301', 'quota', 'Đã huỷ quá nhiều lời mời trong ngày',
    'Tài khoản đã huỷ quá nhiều lời mời kết bạn hôm nay; chạy tiếp lúc {until}', 'Hệ thống tự chạy tiếp sang ngày mới.'],
  ['err_engine_zalo_tag_outdated', 'Z230', 'transient', 'Danh sách nhãn đã đổi',
    'Danh sách nhãn Zalo vừa thay đổi', 'Chạy lại chiến dịch để lấy danh sách nhãn mới.'],
  ['err_engine_zalo_group_invite_pending', 'Z240', 'already_done', 'Đã gửi lời mời, chờ duyệt',
    'Đã gửi lời mời vào nhóm, chờ quản trị viên duyệt', 'Không cần thao tác.']
]

// Luật phân loại mới. [quyết định, pha, loại tín hiệu, mẫu, thao tác, mã lỗi, ghi chú]
const RULES = [
  ['Q5', 'before_send', 'engine', '*', null, 'err_network_offline',
    'Lỗi chưa gửi chưa có luật riêng (lỗi mạng, HTTP, hết giờ của thao tác đọc…): chưa gửi gì, xử lý như mất mạng (NET01).'],
  ['Q3', 'in_flight', 'engine', '*', null, 'err_engine_unknown_delivery',
    'Lỗi khi đang gửi chưa có luật riêng (đứt mạng sau khi kết nối, hết giờ chờ…): không rõ đã tới, không gửi lại (UNK01).'],
  ['Q3', null, 'zalo_code', '-69', null, 'err_engine_unknown_delivery',
    'Zalo trả -69 "Stop retry": không xác nhận được tin đã tới, không gửi lại (UNK01).'],
  ['Q4', null, 'message_like', 'Chưa có session Zalo%', null, 'err_zalo_session_invalid',
    'Desktop chưa có phiên Zalo của tài khoản: như hết phiên (Z600).'],
  ['Q1', null, 'engine', 'target_missing_identity', null, 'err_input_invalid',
    'Data thiếu/sai SĐT, UID, ID nhóm, link (app tự phát hiện): lỗi dữ liệu DAT01, không mượn mã Zalo 114.'],
  ['Q4', null, 'zalo_code', '120', 'zalo_message_friend', 'err_zalo_120_message_stranger',
    'Nhắn bạn bè gặp 120: tài khoản bị hạn chế nhắn người lạ (người nhận không còn là bạn).'],
  ['Q4', null, 'zalo_code', '802', 'zalo_message_friend', 'err_zalo_802_message_stranger', 'Như 120 với mã 802.'],
  ['Q8', null, 'zalo_code', '164', 'zalo_add_group_member', 'err_engine_zalo_not_group_member', 'Thêm thành viên: tài khoản không ở trong nhóm.'],
  ['Q8', null, 'zalo_code', '183', 'zalo_add_group_member', 'err_engine_zalo_group_member_limit', 'Thêm thành viên: nhóm đủ số tối đa.'],
  ['Q8', null, 'zalo_code', '172', 'zalo_join_group_link', 'err_engine_zalo_group_full', 'Vào nhóm bằng link: nhóm đầy.'],
  ['Q8', null, 'zalo_code', '299', 'zalo_join_group_link', 'err_engine_zalo_join_group_day_limit', 'Vào nhóm bằng link: quá số nhóm trong ngày.'],
  ['Q8', null, 'zalo_code', '301', 'zalo_cancel_sent_friend_request', 'err_engine_zalo_cancel_friend_day_limit', 'Huỷ lời mời: quá số lần trong ngày.'],
  ['Q8', null, 'zalo_code', '230', 'zalo_tag_contact', 'err_engine_zalo_tag_outdated', 'Gắn tag: danh sách nhãn đã đổi (Outdated input).'],
  ['Q8', null, 'zalo_code', '240', 'zalo_add_group_member', 'err_engine_zalo_group_invite_pending', 'Thêm thành viên: chờ duyệt.']
]
// Luật seed V495 bị thay bằng luật mới cùng khoá (tắt, gỡ thì bật lại).
const REPLACED_RULES = [['engine', 'target_missing_identity']]

// Chính sách. [quyết định, mã lỗi, thao tác, trường, mô tả, nơi chạy (mặc định cả hai = NULL)]
const POLICIES = [
  // --- Mã do người nhận / data: data hoàn thành ngay (seed), không nghỉ, nhớ theo tài khoản khi lỗi là cố định ---
  ['Q1,Q6', 'err_zalo_user_not_found', ['zalo_find_phone_user'], { ...NO_PACE, ...REMEMBER }, 'Tra số không có Zalo (216/214/212): Zalo vẫn đếm lượt tra (giữ trừ lượt).'],
  ['Q1,Q2,Q6', 'err_zalo_user_not_found', ['zalo_add_friend'], { quota_effect: 'no_count', ...NO_PACE, ...REMEMBER }, 'Kết bạn: không có người dùng.'],
  ['Q1,Q6', 'err_zalo_219_find_phone_invalid', ['zalo_find_phone_user'], { ...NO_PACE, ...REMEMBER }, 'Tra số 219.'],
  ['Q1,Q2,Q6', 'err_zalo_210_target_unavailable', ['zalo_find_phone_user'], { quota_effect: 'count', ...NO_PACE, ...REMEMBER }, 'Tra số 210: Zalo vẫn đếm lượt tra.'],
  ['Q1,Q6', 'err_zalo_210_target_unavailable', ['zalo_add_friend'], { ...NO_PACE, ...REMEMBER }, 'Kết bạn 210.'],
  ['Q1,Q2,Q6', 'err_zalo_receiver_blocks_stranger_message', ['zalo_message_stranger'], { quota_effect: 'count', ...NO_PACE, ...REMEMBER },
    '122: tin đã đi, người nhận chặn tin người lạ: trừ lượt.'],
  ['Q1,Q6', 'err_zalo_receiver_blocks_stranger_message', ['zalo_add_group_member'], { ...NO_PACE, ...REMEMBER }, '122 khi thêm thành viên.'],
  ['Q1,Q2,Q6', 'err_zalo_receiver_blocks_message', ['zalo_message_stranger'], { quota_effect: 'count', ...NO_PACE, ...REMEMBER },
    '119 khi nhắn người lạ: người nhận chặn đúng tài khoản này (tài khoản khác gửi được 86%): trừ lượt, nhớ theo tài khoản.'],
  ['Q1,Q2', 'err_zalo_receiver_blocks_message', ['zalo_message_friend'], { quota_effect: 'count', ...NO_PACE },
    '119 khi nhắn bạn bè: lỗi tạm thời (chính tài khoản gửi lại thành công 58/73), không nhớ.'],
  ['Q1', 'err_zalo_receiver_blocks_message', ['zalo_add_group_member'], NO_PACE, '119 khi thêm thành viên.'],
  ['Q1,Q2,Q6', 'err_zalo_126_127_message_personal', ['zalo_message_stranger'], { quota_effect: 'count', ...NO_PACE, ...REMEMBER }, '126 khi nhắn người lạ.'],
  ['Q1,Q2', 'err_zalo_126_127_message_personal', ['zalo_message_friend'], { quota_effect: 'count', ...NO_PACE }, '126 khi nhắn bạn bè: không nhớ.'],
  ['Q1,Q2', 'err_zalo_126_add_group_member', ['zalo_add_group_member'], { quota_effect: 'no_count', ...NO_PACE }, '126 khi thêm thành viên.'],
  ['Q1,Q2', 'err_zalo_215_251_add_friend_rejected', ['zalo_add_friend'], { quota_effect: 'no_count', ...NO_PACE },
    '215/251: kết bạn không thành công thì không trừ lượt; không nhớ (tài khoản khác kết bạn được 20%).'],
  ['Q2,Q3', 'err_zalo_add_friend_failed', ['zalo_add_friend'], { quota_effect: 'no_count', target_streak_effect: 'ignore' }, '311: không trừ lượt, không cộng chuỗi lỗi.'],
  ['Q1,Q6', 'err_zalo_161_group_not_found', ['zalo_message_group'], { ...NO_PACE, ...REMEMBER }, '161: nhóm đã bị xoá.'],
  ['Q1,Q3,Q6', 'err_zalo_227_join_group_link_invalid', ['zalo_join_group_link'], { target_streak_effect: 'ignore', ...NO_PACE, ...REMEMBER }, '227: link nhóm hỏng.'],
  ['Q1', 'err_zalo_already_friend', ['zalo_add_friend'], NO_PACE, '225: đã là bạn bè.'],
  ['Q1', 'err_zalo_group_member_already_exists', ['zalo_add_group_member', 'zalo_join_group_link', 'zalo_join_group'], NO_PACE, '178: đã là thành viên.'],
  ['Q2,Q3', 'err_zalo_invalid_param', ZALO_ACTIONS, { quota_effect: 'no_count', target_streak_effect: 'ignore' }, '114 do Zalo trả: gửi không đi, không trừ lượt, không cộng chuỗi lỗi.'],
  ['Q2', 'err_zalo_api_business_failed', ['zalo_add_friend'], { quota_effect: 'no_count' }, 'Kết bạn lỗi không mã (Z999): kết bạn không thành công thì không trừ lượt.'],
  ['Q1', 'err_input_invalid', ZALO_ACTIONS, NO_PACE, 'DAT01: data thiếu thông tin, không gọi Zalo nên không nghỉ.'],
  ['Q2,Q3', 'err_zalo_message_too_long', MESSAGE_ACTIONS, { detail_mode: 'suppress', quota_effect: 'no_count', target_streak_effect: 'ignore',
    target_effect: 'requeue', remaining_steps: 'skip', run_effect: 'stop_campaign' }, '118: nội dung quá dài, tạm dừng chiến dịch một lần, data giữ chờ xử lý.'],
  // --- Không rõ kết quả: data hoàn thành, không gửi lại, vẫn cộng chuỗi lỗi như hôm nay ---
  ['Q3', 'err_engine_unknown_delivery', ['zalo_message_stranger', 'zalo_message_friend', 'zalo_message_group', 'zalo_add_group_member'],
    { target_streak_effect: 'increment' }, 'UNK01 khi gửi: cộng chuỗi lỗi như bộ chạy cũ (4 lần liền thì tạm dừng).'],
  ['Q2,Q3', 'err_engine_unknown_delivery', ['zalo_add_friend'], { quota_effect: 'no_count', target_streak_effect: 'increment' },
    'UNK01 khi kết bạn: không trừ lượt (kết bạn không thành công), cộng chuỗi lỗi.'],
  // --- Phiên ---
  ['Q4', 'err_zalo_session_invalid', ZALO_ACTIONS, { remaining_steps: 'skip' }, '600: hết phiên, bỏ bước còn lại (tài khoản dừng, đổi chưa đăng nhập như seed).'],
  // --- Mã do tài khoản (Zalo hạn chế / hết lượt) ---
  ['Q4', 'err_zalo_127_message_stranger', ['zalo_message_stranger'], ACCOUNT_CAUSED, '127: gửi quá nhanh, khoá 30 phút.'],
  ['Q4', 'err_zalo_127_message_friend', ['zalo_message_friend'], ACCOUNT_CAUSED, '127 nhắn bạn bè.'],
  ['Q4', 'err_zalo_126_127_message_group', ['zalo_message_group'], ACCOUNT_CAUSED, '126/127 nhắn nhóm.'],
  ['Q4', 'err_zalo_221_message_group', ['zalo_message_group'], ACCOUNT_CAUSED, '221 nhắn nhóm, khoá 60 phút.'],
  ['Q4', 'err_zalo_221_message_friend', ['zalo_message_friend'], ACCOUNT_CAUSED, '221 nhắn bạn bè.'],
  ['Q4', 'err_zalo_add_friend_limit', ['zalo_add_friend'], ACCOUNT_CAUSED, '221 kết bạn.'],
  ['Q4', 'err_zalo_group_invite_stranger_limit', ['zalo_add_group_member'], ACCOUNT_CAUSED, '314 thêm thành viên.'],
  ['Q4', 'err_zalo_120_message_stranger', ['zalo_message_stranger', 'zalo_message_friend'], ACCOUNT_CAUSED, '120: hạn chế nhắn người lạ tới 09:45 hôm sau.'],
  ['Q4', 'err_zalo_802_message_stranger', ['zalo_message_stranger', 'zalo_message_friend'], ACCOUNT_CAUSED, '802: như 120, khoá 2 ngày.'],
  ['Q4', 'err_zalo_120_add_group_member', ['zalo_add_group_member'], ACCOUNT_CAUSED, '120 thêm thành viên.'],
  ['Q4', 'err_zalo_802_add_group_member', ['zalo_add_group_member'], ACCOUNT_CAUSED, '802 thêm thành viên.'],
  ['Q4', 'err_zalo_find_phone_limit', ['zalo_find_phone_user'], ACCOUNT_CAUSED, '221/312: tra số quá giới hạn giờ.'],
  ['Q4', 'err_zalo_find_phone_day_limit', ['zalo_find_phone_user'], ACCOUNT_CAUSED, '313/304: tra số quá giới hạn ngày.'],
  // --- Lỗi mạng / máy gửi chưa sẵn sàng ---
  ['Q5', 'err_network_offline', ZALO_ACTIONS, { ...NETWORK, log_template: 'Mất kết nối tới Zalo, tạm ngưng tài khoản tới {until}' },
    'NET01: data về chờ xử lý, khoá thao tác Zalo của tài khoản 5 phút, 4 lần liền thì tạm dừng chiến dịch.'],
  ['Q5', 'err_engine_runtime_unavailable', ZALO_ACTIONS, { ...NETWORK, log_template: 'Máy gửi Zalo chưa sẵn sàng, tạm ngưng tài khoản tới {until}' },
    'NET03: như NET01.'],
  // Tra số không rõ kết quả (lệnh Fly): như mất mạng. Dòng seed (mã, thao tác) đã có nên ghi đè theo nơi chạy.
  ['Q5', 'err_engine_unknown_delivery', ['zalo_find_phone_user'], { ...NETWORK, log_template: 'Chưa nhận được kết quả tra số từ Zalo, tạm ngưng tài khoản tới {until}' },
    'Tra số không rõ kết quả: chưa gửi gì cho người nhận, xử lý như NET01.', ['desktop', 'fly']],
  // --- Mã mới ---
  ['Q8', 'err_engine_zalo_not_group_member', [null], { detail_mode: 'suppress', quota_effect: 'no_count', target_streak_effect: 'ignore', target_effect: 'requeue',
    remaining_steps: 'skip', run_effect: 'stop_campaign', campaign_effect: 'pause', pace_mode: 'none' }, 'Z164: tạm dừng chiến dịch một lần, data giữ chờ xử lý.'],
  ['Q8', 'err_engine_zalo_group_member_limit', [null], { detail_mode: 'suppress', quota_effect: 'no_count', target_streak_effect: 'ignore', target_effect: 'requeue',
    remaining_steps: 'skip', run_effect: 'stop_campaign', campaign_effect: 'pause', pace_mode: 'none' }, 'Z183: tạm dừng chiến dịch một lần, data giữ chờ xử lý.'],
  ['Q8', 'err_engine_zalo_group_full', [null], { detail_mode: 'write', detail_status: 'campaign_detail_failed', quota_effect: 'no_count', target_streak_effect: 'ignore',
    target_effect: 'complete', remaining_steps: 'skip', run_effect: 'continue', pace_mode: 'none' }, 'Z172: nhóm đầy, không nhớ (có thể hết đầy).'],
  ['Q8', 'err_engine_zalo_join_group_day_limit', [null], { detail_mode: 'suppress', ...ACCOUNT_CAUSED, run_effect: 'end_unit', pace_mode: 'none',
    lock_action_codes: ['zalo_join_group_link'], lock_mode: 'end_of_day' }, 'Z299: do tài khoản, khoá vào nhóm bằng link tới hết ngày.'],
  ['Q8', 'err_engine_zalo_cancel_friend_day_limit', [null], { detail_mode: 'suppress', ...ACCOUNT_CAUSED, run_effect: 'end_unit', pace_mode: 'none',
    lock_action_codes: ['zalo_cancel_sent_friend_request'], lock_mode: 'end_of_day' }, 'Z301: do tài khoản, khoá huỷ lời mời tới hết ngày.'],
  ['Q8', 'err_engine_zalo_tag_outdated', [null], { detail_mode: 'write', detail_status: 'campaign_detail_failed', quota_effect: 'no_count',
    target_streak_effect: 'ignore', target_effect: 'complete', remaining_steps: 'continue', run_effect: 'continue', pace_mode: 'none' },
  'Z230: gắn tag lỗi vì danh sách nhãn đổi; ghi thất bại (thao tác phụ).'],
  ['Q8', 'err_engine_zalo_group_invite_pending', [null], { detail_mode: 'write', detail_status: 'campaign_detail_success', quota_effect: 'count',
    target_streak_effect: 'reset', target_effect: 'complete', remaining_steps: 'continue', run_effect: 'continue', pace_mode: 'full' }, 'Z240: đã gửi lời mời, chờ duyệt.']
]

const lit = v => v === null || v === undefined ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`
const COLS = ['detail_mode', 'log_template', 'campaign_note_template', 'quota_effect', 'target_streak_effect', 'streak_threshold', 'target_effect',
  'requeue_after_minutes', 'remaining_steps', 'lock_action_codes', 'lock_mode', 'lock_minutes', 'run_effect', 'pace_mode', 'pace_seconds',
  'remember_target_days', 'campaign_effect', 'campaign_hold_minutes']
const valueOf = (col, v) => {
  if (v === undefined || v === null) return 'NULL'
  if (col === 'lock_action_codes') return `ARRAY[${v.map(lit).join(', ')}]::text[]`
  if (typeof v === 'number') return String(v)
  return lit(v)
}
const policyRows = []
for (const [decision, code, actions, fields, note, runtimes] of POLICIES) {
  for (const action of actions) {
    for (const runtime of runtimes ?? [null]) {
      const status = fields.detail_status ? `(SELECT s.id FROM public.auto_status s WHERE s.code = ${lit(fields.detail_status)} AND s.component_type = 'campaign_detail')` : 'NULL'
      policyRows.push(`  (${lit(code)}, ${lit(action)}, ${lit(runtime)}, ${status}, ${COLS.map(c => valueOf(c, fields[c])).join(', ')}, ${lit(`[${decision}] ${note}`)}, 'v500_review')`)
    }
  }
}
const ruleRows = RULES.map(([decision, phase, kind, pattern, action, code, note]) =>
  `  ('zalo', ${lit(action)}, ${lit(phase)}, ${lit(kind)}, ${lit(pattern)}, 10, ${lit(code)}, 'v500_review', ${lit(`[${decision}] ${note}`)})`)
const codeRows = NEW_CODES.map(([code, pub, cls, name, title, help]) =>
  `  ('engine v2', ${lit(code)}, ${lit(name)}, ${lit('V500 (engine v2): ' + name)}, NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}', true, false, ${lit(pub)}, ${lit(cls)}, ${lit(title)}, ${lit(help)})`)
const newCodeList = NEW_CODES.map(r => lit(r[0])).join(', ')

const migration = `-- V500: chính sách xử lý lỗi Zalo theo bảng duyệt đầy đủ, anh duyệt từng câu ngày 11/11/2026. SINH TỪ scripts/build-v500-sql.cjs, không sửa tay.
-- Cần V499 (nhớ mục tiêu theo tài khoản). Bảng duyệt: docs/CAMPAIGN_OUTCOME_ENGINE_ZALO_FULL_REVIEW.md ("Quyết định đã chốt").
--
-- Chỉ dữ liệu, chỉ engine v2 đọc (auto_outcome_policies, auto_outcome_signal_rules, ${NEW_CODES.length} dòng auto_error 'engine v2' không có mã Zalo).
-- Bộ chạy cũ đọc auto_error theo zalo_error_codes nên không đổi; tổ chức chưa bật cờ và Desktop bản cũ không đổi.
--   * ${policyRows.length} dòng chính sách theo (mã lỗi, thao tác[, nơi chạy]), source 'v500_review', chỉ ghi đè trường cần đổi.
--   * ${RULES.length} luật phân loại (source 'v500_review'); tắt luật seed engine/target_missing_identity (thay bằng DAT01).
-- Quyết định ghi trong cột description ([Q1]…[Q8]). Số phút khoá (lock_minutes), số lần liền thì tạm dừng (streak_threshold),
-- số ngày nhớ (remember_target_days) sửa được bằng SQL, có lịch sử (auto_outcome_policy_history).
-- Gỡ: rollback_v500_zalo_error_policies.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v500_%') THEN
      RAISE EXCEPTION 'V500 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_target_memory' AND column_name = 'account_id') THEN
    RAISE EXCEPTION 'V500 cần V499 (nhớ mục tiêu theo tài khoản)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = 'v500_review' AND is_active AND NOT is_delete)
     OR EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = 'v500_review' AND is_active) THEN
    RAISE EXCEPTION 'V500: đã có dòng v500_review';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code IN (${newCodeList}) AND error_type <> 'engine v2') THEN
    RAISE EXCEPTION 'V500: mã mới trùng mã không phải engine v2';
  END IF;
END $pre$;

-- Mã mới chỉ cho engine v2 (gỡ rồi apply lại thì bật lại dòng cũ).
INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES
${codeRows.join(',\n')}
ON CONFLICT (error_code) DO UPDATE SET is_active = true, is_delete = false, public_code = EXCLUDED.public_code, error_class = EXCLUDED.error_class,
  customer_title = EXCLUDED.customer_title, customer_help = EXCLUDED.customer_help
  WHERE public.auto_error.error_type = 'engine v2';

UPDATE public.auto_outcome_signal_rules SET is_active = false, updated_at = now()
 WHERE source = 'seed_v495' AND platform = 'zalo' AND action_code IS NULL AND phase IS NULL AND is_active
   AND (signal_kind, pattern) IN (${REPLACED_RULES.map(([k, p]) => `(${lit(k)}, ${lit(p)})`).join(', ')});

INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
${ruleRows.join(',\n')};

INSERT INTO public.auto_outcome_policies (error_code, action_code, runtime_target, detail_status_id, ${COLS.join(', ')}, description, source) VALUES
${policyRows.join(',\n')};

DO $post$
DECLARE v_bad text; v_n integer;
BEGIN
  SELECT string_agg(issue || ':' || subject, ', ') INTO v_bad FROM public.aka_agent_engine_policy_lint;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V500 postflight lint: %', v_bad; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE source = 'v500_review' AND is_active AND NOT is_delete;
  IF v_n <> ${policyRows.length} THEN RAISE EXCEPTION 'V500 postflight: % dòng chính sách, cần ${policyRows.length}', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_signal_rules WHERE source = 'v500_review' AND is_active;
  IF v_n <> ${RULES.length} THEN RAISE EXCEPTION 'V500 postflight: % luật, cần ${RULES.length}', v_n; END IF;
  -- Mã mới không được lọt vào bộ kiểm của bản cũ.
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code IN (${newCodeList})
               AND (error_type <> 'engine v2' OR cardinality(zalo_error_codes) > 0 OR counts_toward_limit OR counts_toward_bad_target)) THEN
    RAISE EXCEPTION 'V500 postflight: mã mới phải là engine v2, không có mã Zalo';
  END IF;
  -- Trả data về hàng đợi phải có đường dừng (khoá thao tác, tạm dừng chiến dịch ngay hoặc theo ngưỡng, dừng tài khoản), không lặp vô hạn.
  SELECT string_agg(p.error_code || '/' || coalesce(p.action_code, '*'), ', ') INTO v_bad
    FROM public.auto_outcome_policies p
    CROSS JOIN LATERAL (SELECT public.aka_agent_engine_resolve_policy(p.error_code, NULL, coalesce(p.action_code, 'zalo_find_phone_user'), NULL,
                                 coalesce(p.runtime_target, 'fly'), 'after_send') AS eff) x
   WHERE p.source = 'v500_review' AND p.is_active AND NOT p.is_delete
     AND x.eff->>'target_effect' = 'requeue'
     AND coalesce(x.eff->>'campaign_effect', 'none') <> 'pause'
     AND coalesce(x.eff->>'run_effect', '') NOT IN ('stop_campaign', 'stop_account')
     AND coalesce(x.eff->>'login_effect', 'none') = 'none'
     AND coalesce(x.eff->'lock_action_codes', '[]'::jsonb) = '[]'::jsonb;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V500 postflight: trả data về hàng đợi mà không có đường dừng: %', v_bad; END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V500: xoá chính sách và luật v500_review, bật lại luật seed đã tắt, tắt mã mới (không xoá dòng auto_error vì lịch sử
-- hoặc bộ nhớ mục tiêu có thể đã tham chiếu). SINH TỪ scripts/build-v500-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DELETE FROM public.auto_outcome_policies WHERE source = 'v500_review';
DELETE FROM public.auto_outcome_signal_rules WHERE source = 'v500_review';
UPDATE public.auto_outcome_signal_rules SET is_active = true, updated_at = now()
 WHERE source = 'seed_v495' AND platform = 'zalo' AND action_code IS NULL AND phase IS NULL AND NOT is_active
   AND (signal_kind, pattern) IN (${REPLACED_RULES.map(([k, p]) => `(${lit(k)}, ${lit(p)})`).join(', ')});
UPDATE public.auto_error SET is_active = false, is_delete = true
 WHERE error_type = 'engine v2' AND error_code IN (${newCodeList});

DO $post$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(issue || ':' || subject, ', ') INTO v_bad FROM public.aka_agent_engine_policy_lint;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Gỡ V500 postflight lint: %', v_bad; END IF;
END $post$;

COMMIT;
`

module.exports = { POLICIES, RULES, NEW_CODES, ZALO_ACTIONS, ACCOUNT_CAUSED, NETWORK, migration, rollback, policyRowCount: policyRows.length }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v500_zalo_error_policies.sql'), rollback)
  console.log(`V500: ${policyRows.length} dòng chính sách, ${RULES.length} luật, ${NEW_CODES.length} mã mới; migration ${md5(migration)}, rollback ${md5(rollback)}`)
}
