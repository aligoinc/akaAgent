#!/usr/bin/env node
// Sinh V559 (BẢN NHÁP, CHƯA DUYỆT): mã lỗi Facebook mới của engine v2 (FB42–FB45), luật phân loại tín hiệu Facebook, chính sách Facebook
// giữ đúng hành vi bộ cũ, và bảng duyệt docs/CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_FULL_REVIEW.md.
//
// Nguồn: danh mục production đọc chỉ đọc (scripts/engine-v2-facebook/read-catalog.cjs → scripts/fixtures/engine-v2-facebook/catalog-live-*.json)
// và code bộ cũ: actionResultRuntime.ts writeManagedActionResult (cột đếm của auto_error chỉ áp khi detail_mode khác NULL hoặc thao tác
// fb_add_friend; comment lỗi sau khi data đã gửi không cộng chuỗi), actionStatusPolicy.ts ActionStatusCatalog.resolve (trạng thái lịch sử
// là trạng thái block trả, trừ detail_mode override), campaignScheduler.ts normalizeRuntimeError (đoán FB01–FB03 theo câu lỗi).
//
// Anh chốt Q3 / Q23 (16/11): duyệt bảng FB trước lần bật đầu, mỗi mã một câu cho khách + câu bước tiếp theo; anh chốt 16/11 tối: duyệt ở
// cuối, sau khi code xong 13 loại. Sửa bộ sinh theo bảng đã chốt rồi mới apply. Áp sẵn ở bản nháp những gì anh đã chốt: Q6 (checkpoint /
// đăng xuất chỉ là trạng thái đăng nhập, không khoá), Q20 (block treo: chưa tới mốc thì về hàng đợi, đã tới mốc thì không rõ kết quả).
//
// CHỈ DỮ LIỆU, CHỈ engine v2 đọc. Bộ cũ đọc auto_error như cũ: 3 mã mới là 'engine v2' (bộ cũ bỏ qua); không sửa dòng auto_error nào của FB.
// Cách ghi: tắt các dòng seed_v495_error của mã FB (dựng theo luật của Zalo, lệch bộ cũ: phương án mục 5.3) và thêm dòng 'v559_fb_draft'.
// Cần V558 (resolve_policy giải detail_mode = inherit như bộ cũ).
// Gỡ: rollback_v559_engine_facebook_policies.sql. Chạy: node scripts/build-v559-sql.cjs [catalog.json]
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SOURCE = 'v559_fb_draft'
const CATALOG_FILE = path.resolve(process.argv[2] || path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/catalog-live-20261116.json'))
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'))

const FB_ERRORS = catalog.fbErrors.filter(e => e.error_type === 'external facebook' && e.is_active !== false && e.is_delete !== true)
  .sort((a, b) => String(a.public_code).localeCompare(String(b.public_code)))
const FB_CODES = FB_ERRORS.map(e => e.error_code)
const FB_ACTIONS = catalog.fbActions.map(a => a.code)
const STATUSES = catalog.statuses
const statusById = id => STATUSES.find(s => Number(s.id) === Number(id)) ?? null
const statusByValue = value => STATUSES.find(s => s.statusValue === value) ?? null
const statusByCode = code => STATUSES.find(s => s.code === code) ?? null
const SEED_ROWS = catalog.policies.filter(p => p.source === 'seed_v495_error' && FB_CODES.includes(p.error_code) && p.action_code == null)

/**
 * Vân tay các cột của auto_error FB mà bản nháp dựa vào (preflight so với production lúc apply). Phải trùng từng byte với câu SQL
 * FINGERPRINT_SQL bên dưới: mỗi dòng nối bằng '|', NULL = chuỗi rỗng, mảng nối bằng ',', các dòng nối bằng xuống dòng theo error_code (C).
 */
const FP_COLS = ['error_code', 'detail_mode', 'detail_status', 'detail_status_id', 'input_effect', 'counts_toward_limit', 'counts_toward_bad_target',
  'count_consecutive_errors', 'update_status_campaign', 'update_status_account', 'update_login_status', 'disable_action_codes', 'disable_action_mode',
  'time_disable_actions', 'disable_action_days', 'disable_action_time', 'noti_running_process', 'noti_campaign']
const fpValue = v => v === null || v === undefined ? '' : Array.isArray(v) ? v.join(',') : String(v)
const FINGERPRINT = md5([...FB_ERRORS].sort((a, b) => (a.error_code < b.error_code ? -1 : a.error_code > b.error_code ? 1 : 0))
  .map(e => FP_COLS.map(c => fpValue(e[c])).join('|')).join('\n'))
const FINGERPRINT_SQL = `md5(string_agg(concat_ws('|', ${FP_COLS.map(c => c === 'disable_action_codes'
  ? `coalesce(array_to_string(e.${c}, ','), '')` : `coalesce(e.${c}::text, '')`).join(', ')}), E'\\n' ORDER BY e.error_code COLLATE "C"))`

// ------------------------------------------------------------------------------------------------ mã mới
// [mã, mã công khai, nhóm, tên, câu cho khách, bước tiếp theo]
const NEW_CODES = [
  ['err_engine_fb_action_failed', 'FB42', 'target_permanent', 'Thao tác Facebook không thành công',
    'Thao tác trên Facebook không thành công', ''],
  ['err_engine_fb_logged_out', 'FB43', 'auth', 'Tài khoản Facebook đã đăng xuất',
    'Tài khoản Facebook đã bị đăng xuất', 'Đăng nhập lại Facebook trong tab trình duyệt của tài khoản.'],
  ['err_engine_fb_ui_not_ready', 'FB44', 'ui_changed', 'Không thấy nút hoặc ô cần thao tác trên Facebook',
    'Không thấy nút hoặc ô cần bấm trên Facebook', 'Mở tab trình duyệt của tài khoản để kiểm tra.'],
  // Phát lại lịch sử thật 16/11: bộ cũ không ghi dòng nào cho một số bước đã chạy xong (Like khi comment seeding, comment tự bỏ qua khi
  // bài chờ duyệt). Engine vẫn phải giải dấu "sắp gửi" của bước đó: mã này không ghi lịch sử, không in tiến trình, không tính lượt.
  ['err_engine_fb_no_history', 'FB45', 'already_done', 'Bước không ghi lịch sử (như bộ cũ)',
    'Bước không ghi lịch sử', '']
]
const NEW_CODE_LIST = NEW_CODES.map(r => r[0])

// ------------------------------------------------------------------------------------------------ luật phân loại
// [pha, loại tín hiệu, mẫu, thao tác, mã lỗi, ghi chú]. Tín hiệu do cổng Facebook gửi: milestoneOutcomes.ts (detailInputOutcome,
// blockFailureOutcome, facebookPageStateSignal), campaignScheduler.ts (mark_refused). Mã block trả (actionResult.errorCode) dùng thẳng.
const RULES = [
  [null, 'block', 'status:campaign_detail_failed', null, 'err_engine_fb_action_failed',
    'Dòng "thất bại" mà bộ dựng lịch sử của bộ cũ ghi khi block không trả mã (comment, nhắn tin, kết bạn…): ghi theo trạng thái như bộ cũ.'],
  [null, 'block', 'status:campaign_detail_error', null, 'err_engine_fb_action_failed', 'Dòng "lỗi" không mã (form đăng bài không đóng…).'],
  [null, 'block', 'status:campaign_detail_not_found', null, 'err_engine_fb_action_failed', 'Dòng "không tồn tại" không mã.'],
  [null, 'block', 'status:campaign_detail_invalid_parameter', null, 'err_engine_fb_action_failed', 'Dòng "tham số không hợp lệ" không mã.'],
  [null, 'engine', 'fb_checkpoint', null, 'err_fb_checkpoint', 'Trang chạy ngầm đang ở trang xác minh của Facebook khi block lỗi (Q6).'],
  [null, 'engine', 'fb_logged_out', null, 'err_engine_fb_logged_out', 'Trang chạy ngầm đang ở trang đăng nhập Facebook khi block lỗi (Q6).'],
  ['before_send', 'engine', 'block_hang', null, 'err_runtime_browser', 'Block không có thao tác nào quá ngưỡng, chưa tới mốc gửi: chưa gửi gì (Q20).'],
  ['in_flight', 'engine', 'block_hang', null, 'err_engine_unknown_delivery', 'Block treo sau dấu "sắp gửi": không rõ kết quả, không gửi lại (Q20).'],
  ['before_send', 'engine', 'browser_gone', null, 'err_runtime_browser', 'Cửa sổ chạy ngầm chết trước mốc gửi.'],
  ['in_flight', 'engine', 'browser_gone', null, 'err_engine_unknown_delivery', 'Cửa sổ chạy ngầm chết sau dấu "sắp gửi": không rõ kết quả.'],
  ['before_send', 'block', '*', null, 'err_engine_fb_ui_not_ready',
    'Thao tác trên trang lỗi trước mốc gửi (không thấy phần tử, hết giờ chờ…), theo vết thao tác. Sau mốc gửi thì không có luật riêng (SYS99 như bộ cũ).'],
  [null, 'message_like', '%bạn đã đạt giới hạn về số tin nhắn đang chờ%', null, 'err_limit_waiting_message',
    'Như normalizeRuntimeError của bộ cũ: đoán mã theo câu lỗi.'],
  [null, 'message_like', '%giới hạn tần suất comment%', null, 'err_comment_frequency_limit', 'Như bộ cũ.'],
  [null, 'message_like', '%giới hạn tần suất bạn đăng bài%', 'fb_post_group', 'err_group_post_frequency_limit', 'Như bộ cũ (chỉ đăng nhóm).'],
  [null, 'engine', 'mark_refused:action_unknown', null, 'err_system_block_load',
    'Bước gửi khai thao tác chưa có trong danh mục: lỗi cấu hình của mình (SYS03), chưa bấm gì.']
]

// ------------------------------------------------------------------------------------------------ chính sách
const INPUT = { pause: 'hold', requeue: 'requeue', complete: 'complete' }
const CAMPAIGN = { 'tạm dừng': 'pause', 'chờ xử lý': 'hold' }
const LOGIN = { 'chưa đăng nhập': 'logged_out', checkpoint: 'checkpoint' }
const hasSideEffect = e => !!(e.update_status_campaign || e.update_status_account || e.update_login_status || (e.disable_action_codes || []).length)

/** Chính sách giữ đúng hành vi bộ cũ cho một mã FB (dòng theo mã, mọi thao tác). */
function legacyDraft(e) {
  const mode = e.detail_mode === 'override' ? 'write' : e.detail_mode === 'suppress' ? 'suppress' : 'inherit'
  const status = e.detail_mode === 'override' ? (statusById(e.detail_status_id) ?? statusByValue(e.detail_status)) : statusByValue(e.detail_status)
  const errorCounting = e.detail_mode != null
  return {
    detail_mode: mode, detail_status: status?.code ?? null,
    log_template: e.noti_running_process ?? e.noti_campaign ?? null, campaign_note_template: e.noti_campaign ?? null,
    quota_effect: errorCounting ? (mode !== 'suppress' && e.counts_toward_limit ? 'count' : 'no_count') : null,
    target_streak_effect: errorCounting ? (mode !== 'suppress' && e.counts_toward_bad_target ? 'increment' : 'ignore') : null,
    streak_threshold: e.count_consecutive_errors || null,
    target_effect: INPUT[e.input_effect] ?? (mode === 'suppress' ? 'complete' : null),
    remaining_steps: 'continue',
    lock_action_codes: e.disable_action_codes ?? [], lock_mode: e.disable_action_mode || 'fixed_minutes', lock_minutes: e.time_disable_actions ?? null,
    lock_days: e.disable_action_days ?? null, lock_time: e.disable_action_time ?? null,
    run_effect: hasSideEffect(e) ? 'end_unit' : 'continue', pace_mode: 'full',
    campaign_effect: CAMPAIGN[e.update_status_campaign] ?? 'none',
    account_effect: e.update_status_account === 'tạm dừng' ? 'pause' : 'none',
    login_effect: LOGIN[e.update_login_status] ?? 'none'
  }
}

// Q6 (16/11): checkpoint / đăng xuất chỉ là trạng thái đăng nhập. Data chưa tới mốc gửi về hàng đợi (đã tới mốc thì DB không trả về hàng
// đợi: no_requeue_after_delivery), không khoá thao tác, không tạm dừng tài khoản hay chiến dịch; claim chỉ nhận tài khoản "đã đăng nhập".
const LOGIN_STATE = { detail_mode: 'suppress', detail_status: null, quota_effect: 'no_count', target_streak_effect: 'ignore', streak_threshold: null,
  target_effect: 'requeue', remaining_steps: 'skip', lock_action_codes: [], lock_mode: 'fixed_minutes', lock_minutes: null, lock_days: null,
  lock_time: null, run_effect: 'stop_account', pace_mode: 'none', campaign_effect: 'none', account_effect: 'none' }
const DECIDED = {
  err_fb_checkpoint: { ...LOGIN_STATE, login_effect: 'checkpoint', why: 'Q6: chỉ đổi trạng thái đăng nhập sang checkpoint, không khoá, không tạm dừng tài khoản.' },
  // Bộ cũ không đi qua chính sách mã này: không chuyển được sang Page trước data thì pauseBeforePageIdentityTarget (campaignScheduler.ts)
  // nhả lượt mà không dùng data, không ghi lịch sử, tạm dừng chiến dịch kèm câu lỗi. Không block nào trả mã này (chỉ engine báo khi chuyển
  // Page lỗi); phát lại lịch sử thật 16/11: chính sách dựng theo cột auto_error làm engine đốt data và tính lượt.
  err_fb_identity_switch_failed: { detail_mode: 'suppress', detail_status: null, quota_effect: 'no_count', target_streak_effect: 'ignore',
    streak_threshold: null, target_effect: 'requeue', remaining_steps: 'skip', lock_action_codes: [], lock_mode: 'fixed_minutes', lock_minutes: null,
    lock_days: null, lock_time: null, run_effect: 'end_unit', pace_mode: 'none', campaign_effect: 'pause', campaign_note_template: '{message}',
    account_effect: 'none', login_effect: 'none',
    why: 'bộ cũ: không chuyển được sang Page trước data thì không dùng data, không ghi lịch sử, tạm dừng chiến dịch kèm câu lỗi (pauseBeforePageIdentityTarget).' }
}

// Câu cho khách (Q23: một câu dùng chung mọi chỗ + câu bước tiếp theo): ANH ĐÃ DUYỆT TỪNG CÂU 17/11. Câu lỗi là câu lịch sử / tiến trình / ghi
// chú data của engine và customer_title; câu bước tiếp theo ('' = không hiện) nối vào ghi chú chiến dịch khi dừng / chờ và customer_help.
// Câu bước tiếp theo phải khớp hành vi của chính mã đó (R13, rà 17/11): data bị đóng thì không ghi "tự thử lại"; chiến dịch / tài khoản bị
// tạm dừng thì ghi "bấm Tiếp tục". Anh chốt 17/11: câu bước tiếp theo CHỈ HIỆN KHI KHÁCH CẦN LÀM GÌ; câu kiểu "không cần thao tác", "chờ…",
// "hệ thống tự chạy tiếp" để trống ('' = không hiện). Cũng anh chốt 17/11: chữ dễ hiểu với người bình thường (tránh "quyền", "phiên", "danh
// tính"…); câu lỗi đã tự rõ thì không cần bước tiếp theo; bước tiếp theo không đoán nguyên nhân (FB41: chỉ bảo mở tab trình duyệt để kiểm tra).
const CUSTOMER = {
  err_limit_waiting_message: ['Facebook đang hạn chế nhắn tin cho người lạ', ''],
  err_group_post_frequency_limit: ['Facebook báo tài khoản đăng bài vào nhóm quá nhanh', 'Giảm số bài mỗi giờ hoặc tăng thời gian nghỉ, rồi bấm Tiếp tục chiến dịch.'],
  err_comment_frequency_limit: ['Facebook báo tài khoản bình luận quá nhanh', 'Giảm số bình luận hoặc tăng thời gian nghỉ, rồi bấm Tiếp tục chiến dịch.'],
  err_fb_checkpoint: ['Facebook yêu cầu xác minh tài khoản', 'Mở tab trình duyệt của tài khoản và xác minh với Facebook; xong thì chiến dịch tự chạy tiếp.'],
  err_fb_feature_blocked: ['Facebook đang tạm chặn tính năng này của tài khoản', ''],
  err_fb_identity_switch_failed: ['Không chuyển được sang Page để đăng bài', 'Kiểm tra tài khoản còn quản lý Page này và tên Page trong chiến dịch đã đúng chưa, rồi bấm Tiếp tục chiến dịch.'],
  err_fb_identity_restore_failed: ['Không chuyển lại được về tài khoản cá nhân sau khi dùng Page', 'Mở tab trình duyệt của tài khoản, tự đổi về tài khoản cá nhân rồi cho tài khoản chạy lại.'],
  err_fb_page_permission_token_missing: ['Tài khoản chưa đăng nhập Facebook Business', 'Đăng nhập Facebook Business trong tab trình duyệt của tài khoản.'],
  err_fb_page_permission_no_page_token: ['Tài khoản không đăng được bài lên Page này', 'Kiểm tra tài khoản còn là quản trị viên của Page.'],
  err_fb_page_permission_api_error: ['Facebook đang lỗi tạm thời, chưa đăng được bài lên Page', ''],
  err_fb_group_cannot_post_not_member: ['Tài khoản chưa vào nhóm này nên chưa đăng bài được', ''],
  err_fb_group_cannot_post_join_pending: ['Đang chờ duyệt tham gia nhóm', ''],
  err_fb_group_cannot_post_admin_only: ['Nhóm này chỉ cho quản trị viên đăng bài', ''],
  err_fb_group_cannot_post_unavailable: ['Nhóm không tồn tại', ''],
  err_fb_comment_unavailable_post_pending: ['Bài viết đang chờ duyệt nên chưa bình luận được', ''],
  err_fb_comment_unavailable_comment_disabled: ['Bài viết đã tắt bình luận', ''],
  err_fb_comment_unavailable_post_not_found: ['Không tìm thấy bài viết để bình luận', 'Kiểm tra link bài viết còn tồn tại.'],
  err_fb_comment_unavailable_not_member: ['Tài khoản chưa vào nhóm này nên chưa bình luận được', ''],
  err_fb_messenger_unavailable_target_not_messageable: ['Người này không nhận tin nhắn từ tài khoản', ''],
  err_fb_messenger_unavailable_e2ee_pin_required: ['Messenger yêu cầu mã PIN hoặc khôi phục tin nhắn', 'Mở Messenger trong tab trình duyệt của tài khoản và làm theo yêu cầu của Facebook.'],
  err_fb_messenger_unavailable_account_restricted: ['Facebook đang hạn chế nhắn tin của tài khoản', ''],
  err_fb_add_friend_unavailable: ['Không gửi được lời mời kết bạn (Facebook ẩn nút kết bạn)', ''],
  err_fb_page_inbox_customer_not_found: ['Không tồn tại', ''],
  err_fb_page_inbox_wrong_conversation: ['Không tìm đúng cuộc trò chuyện với khách này trên Page', ''],
  err_fb_page_inbox_cannot_reply_outside_window: ['Đã quá thời gian Facebook cho Page nhắn lại khách này', ''],
  err_fb_page_inbox_cannot_reply_blocked_by_user: ['Khách không nhận tin nhắn từ Page', ''],
  err_fb_join_group_failed_limit: ['Facebook tạm không cho tài khoản tham gia thêm nhóm', ''],
  err_fb_join_group_failed_questions_required: ['Nhóm bắt trả lời câu hỏi mới cho tham gia', ''],
  err_fb_join_group_failed_ui: ['Không bấm được nút tham gia nhóm', 'Mở tab trình duyệt của tài khoản để kiểm tra.'],
  err_fb_post_not_confirmed: ['Chưa xác nhận được bài đã đăng', 'Kiểm tra bài trên Facebook trước khi tự đăng lại.'],
  err_fb_post_not_published_content_blocked: ['Facebook không cho đăng nội dung hoặc link này', 'Sửa nội dung hoặc link rồi bấm Tiếp tục chiến dịch.'],
  err_fb_post_not_published_duplicate: ['Facebook báo bài bị trùng nội dung', 'Thêm nhiều biến thể nội dung để mỗi bài khác nhau.'],
  err_fb_formatted_content_rejected: ['Facebook không nhận nội dung có định dạng (chữ đậm, nghiêng…)', 'Tắt định dạng hoặc dùng nội dung thường.'],
  err_fb_media_upload_timeout: ['Tải ảnh hoặc video lên Facebook chưa hoàn tất', 'Nên dùng ảnh hoặc video nhỏ hơn.'],
  err_fb_composer_editor_not_found: ['Không mở được ô viết bài trên trang cá nhân', 'Mở tab trình duyệt của tài khoản để kiểm tra.'],
  err_fb_post_button_not_found: ['Không thấy nút Đăng hoặc nút Chia sẻ', 'Mở tab trình duyệt của tài khoản để kiểm tra.'],
  err_fb_page_inbox_ui: ['Hộp thư Page chưa mở được', 'Mở tab trình duyệt của tài khoản để kiểm tra.'],
  err_fb_upload_form_changed: ['Không thấy chỗ tải ảnh hoặc video lên Facebook', 'Mở tab trình duyệt của tài khoản để kiểm tra.'],
  err_fb_group_invite_ui: ['Không mở được chỗ mời bạn bè vào nhóm', 'Mở tab trình duyệt của tài khoản để kiểm tra.'],
  err_fb_group_composer_editor_not_found: ['Không thấy ô đăng bài trong nhóm', ''],
  err_fb_comment_box_not_found: ['Không thấy ô bình luận dưới bài', 'Mở tab trình duyệt của tài khoản để kiểm tra.']
}

/** Ghi chú chiến dịch khi mã làm chiến dịch dừng / chờ: "câu lỗi (FBxx). bước tiếp theo", hoặc chỉ câu lỗi (engine tự thêm mã). */
function customerNote(code, pub) {
  const [title, help] = CUSTOMER[code]
  return help ? `${title} (${pub}). ${help}` : title
}

/** [mã, thao tác, trường, mô tả] */
const POLICIES = []
for (const e of FB_ERRORS) {
  const decided = DECIDED[e.error_code]
  const fields = decided ? { ...legacyDraft(e), ...decided } : legacyDraft(e)
  delete fields.why
  // Anh duyệt 17/11 (Q23): câu lỗi thay câu bộ cũ ở lịch sử / tiến trình / ghi chú data; ghi chú chiến dịch khi dừng / chờ = câu lỗi (mã) +
  // bước tiếp theo nếu có. Bộ cũ giữ noti_running_process / noti_campaign như cũ.
  Object.assign(fields, { log_template: CUSTOMER[e.error_code][0], campaign_note_template: customerNote(e.error_code, e.public_code) })
  POLICIES.push([e.error_code, null, fields, decided ? `[${decided.why.split(':')[0]}] ${decided.why}`
    : `[bộ cũ] ${e.public_code}: dựng từ auto_error id ${e.id} theo cách tính của bộ cũ Facebook.`])
  // Bộ cũ: thao tác kết bạn luôn dùng cột đếm của auto_error (actionResultRuntime.ts:151); mã khác chỉ khi detail_mode khác NULL.
  if (!decided && e.detail_mode == null) {
    POLICIES.push([e.error_code, 'fb_add_friend', { quota_effect: e.counts_toward_limit ? 'count' : 'no_count',
      target_streak_effect: e.counts_toward_bad_target ? 'increment' : 'ignore' }, `[bộ cũ] ${e.public_code} khi kết bạn: đếm theo cột auto_error.`])
  }
}
POLICIES.push(['err_engine_fb_action_failed', null, { detail_mode: 'inherit', detail_status: 'campaign_detail_failed', log_template: '{message}',
  remaining_steps: 'continue', lock_action_codes: [], lock_mode: 'fixed_minutes', run_effect: 'continue', pace_mode: 'full', campaign_effect: 'none',
  account_effect: 'none', login_effect: 'none' }, '[bộ cũ] FB42: dòng lịch sử không mã của bộ dựng cũ: trạng thái, câu, cách đếm theo trạng thái như bộ cũ.'])
POLICIES.push(['err_engine_fb_logged_out', null, { ...LOGIN_STATE, login_effect: 'logged_out' },
  '[Q6] FB43: trang đăng nhập: đổi trạng thái đăng nhập, data chưa gửi về hàng đợi, không khoá.'])
POLICIES.push(['err_engine_fb_ui_not_ready', null, { detail_mode: 'write', detail_status: 'campaign_detail_error', quota_effect: 'no_count',
  target_streak_effect: 'increment', target_effect: 'complete', remaining_steps: 'skip', lock_action_codes: [], lock_mode: 'fixed_minutes',
  run_effect: 'continue', pace_mode: 'full', campaign_effect: 'none', account_effect: 'none', login_effect: 'none' },
'[bộ cũ] FB44: như lỗi không xác định của bộ cũ (ghi "lỗi", không tính lượt, cộng chuỗi, 4 lần liền thì tạm dừng theo SYS99), câu cho khách rõ hơn.'])
POLICIES.push(['err_engine_fb_no_history', null, { detail_mode: 'suppress', detail_status: null, quota_effect: 'no_count', target_streak_effect: 'ignore',
  target_effect: 'complete', remaining_steps: 'continue', lock_action_codes: [], lock_mode: 'fixed_minutes', run_effect: 'continue', pace_mode: 'full',
  campaign_effect: 'none', account_effect: 'none', login_effect: 'none' },
'[bộ cũ] FB45: block chạy xong mà bộ dựng lịch sử của bộ cũ không ghi dòng nào (Like khi comment seeding, comment tự bỏ qua khi bài chờ duyệt, comment seeding không có bài): không ghi lịch sử, không tính lượt, không cộng chuỗi, vẫn nghỉ giữa 2 data như bộ cũ.'])
// Q20: cửa sổ chạy ngầm chết / block treo trước mốc gửi: chưa gửi gì, data về hàng đợi; 4 lần liền thì tạm dừng chiến dịch.
for (const action of FB_ACTIONS) {
  POLICIES.push(['err_runtime_browser', action, { detail_mode: 'suppress', quota_effect: 'no_count', target_streak_effect: 'increment', streak_threshold: 4,
    target_effect: 'requeue', remaining_steps: 'skip', lock_action_codes: [], run_effect: 'end_unit', pace_mode: 'none', campaign_effect: 'pause' },
  '[Q20] SYS04 với thao tác Facebook: data về hàng đợi, 4 lần liền thì tạm dừng chiến dịch.'])
}
// Bộ cũ: nhắn inbox Page lỗi đủ ngưỡng thì tự chạy lại thêm 1 lần, chỉ tạm dừng khi đủ gấp đôi ngưỡng (shouldRetryPageInboxOnce,
// campaignScheduler.ts applyErrorPolicy; phát lại lịch sử thật 16/11). SYS99 là mã có ngưỡng duy nhất của bộ cũ gặp ở loại này.
POLICIES.push(['err_undefined', 'fb_message_page_inbox_customer', { streak_threshold: 8 },
  '[bộ cũ] SYS99 khi nhắn inbox Page: bộ cũ tự chạy lại thêm 1 lần sau 4 lỗi liền, tạm dừng khi đủ 8 lần liền.'])
// Bộ cũ: comment lỗi khi data đã có kết quả gửi thành công không cộng chuỗi data lỗi (targetOnlyFailure, actionResultRuntime.ts:160).
const GUARDS = [['fb_comment', { streak_after_delivery: 'ignore' }, '[bộ cũ] Comment lỗi sau khi đã đăng / gửi thành công: không cộng chuỗi data lỗi.']]

const COLS = ['detail_mode', 'log_template', 'campaign_note_template', 'quota_effect', 'target_streak_effect', 'streak_threshold', 'target_effect',
  'requeue_after_minutes', 'remaining_steps', 'lock_action_codes', 'lock_mode', 'lock_minutes', 'lock_days', 'lock_time', 'run_effect', 'pace_mode',
  'pace_seconds', 'campaign_effect', 'campaign_hold_minutes', 'account_effect', 'login_effect', 'streak_after_delivery']
const lit = v => v === null || v === undefined ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`
const valueOf = (col, v) => {
  if (v === undefined || v === null) return 'NULL'
  if (col === 'lock_action_codes') return `ARRAY[${v.map(lit).join(', ')}]::text[]`
  if (col === 'lock_time') return `${lit(v)}::time`
  if (typeof v === 'number') return String(v)
  return lit(v)
}
const statusSql = code => code ? `(SELECT s.id FROM public.auto_status s WHERE s.code = ${lit(code)} AND s.component_type = 'campaign_detail')` : 'NULL'
const policyRows = POLICIES.map(([code, action, fields, note]) =>
  `  (${lit(code)}, NULL, ${lit(action)}, ${statusSql(fields.detail_status)}, ${COLS.map(c => valueOf(c, fields[c])).join(', ')}, ${lit(note)}, '${SOURCE}')`)
const guardRows = GUARDS.map(([action, fields, note]) =>
  `  (NULL, NULL, ${lit(action)}, NULL, ${COLS.map(c => valueOf(c, fields[c])).join(', ')}, ${lit(note)}, '${SOURCE}')`)
const ruleRows = RULES.map(([phase, kind, pattern, action, code, note]) =>
  `  ('facebook', ${lit(action)}, ${lit(phase)}, ${lit(kind)}, ${lit(pattern)}, 20, ${lit(code)}, '${SOURCE}', ${lit(note)})`)
const codeRows = NEW_CODES.map(([code, pub, cls, name, title, help]) =>
  `  ('engine v2', ${lit(code)}, ${lit(name)}, ${lit('V559 (engine v2, Facebook): ' + name)}, NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}', true, false, ${lit(pub)}, ${lit(cls)}, ${lit(title)}, ${lit(help || null)})`)
const fbCodeList = FB_CODES.map(lit).join(', ')
const newCodeList = NEW_CODE_LIST.map(lit).join(', ')
const ruleCodes = [...new Set(RULES.map(r => r[4]))]
const POLICY_COUNT = policyRows.length + guardRows.length
// Anh chốt 17/11: sửa luôn dòng FB04 của bộ cũ: bỏ khoá 11 thao tác và bỏ tạm dừng tài khoản (khoá rồi khách phải tự mở lại), giữ chiến dịch
// về chờ xử lý và đăng nhập → checkpoint. Bộ cũ không có code phát FB04 nên khách không thấy khác. Tiền lệ sửa auto_error: V472.
const FB04 = FB_ERRORS.find(e => e.error_code === 'err_fb_checkpoint')
if (!FB04 || !(FB04.disable_action_codes ?? []).length || FB04.update_status_account !== 'tạm dừng' || FB04.update_status_campaign !== 'chờ xử lý'
  || FB04.update_login_status !== 'checkpoint') throw new Error('Dòng FB04 trong danh mục không còn như lúc anh chốt (17/11): đọc lại rồi hỏi anh')
const FB04_CODES_SQL = `ARRAY[${FB04.disable_action_codes.map(lit).join(', ')}]::text[]`
// Câu cho khách anh duyệt 17/11: [mã, câu, bước tiếp theo] mới và giá trị cũ để bản gỡ trả lại.
const customerRows = FB_ERRORS.map(e => `  (${lit(e.error_code)}, ${lit(CUSTOMER[e.error_code][0])}, ${lit(CUSTOMER[e.error_code][1] || null)})`)
const customerOldRows = FB_ERRORS.map(e =>
  `  (${lit(e.error_code)}, ${lit(e.customer_title ?? null)}, ${lit(e.customer_help ?? null)}, ${lit(CUSTOMER[e.error_code][0])})`)

const migration = `-- V559 (BẢN NHÁP, CHƯA DUYỆT): engine v2 Facebook: ${NEW_CODES.length} mã mới (FB42–FB45), ${RULES.length} luật phân loại tín hiệu Facebook, chính sách Facebook giữ đúng
-- hành vi bộ cũ (trừ Q6 checkpoint / đăng xuất, Q20 block treo đã chốt). SINH TỪ scripts/build-v559-sql.cjs, không sửa tay.
-- Danh mục nguồn: ${path.relative(ROOT, CATALOG_FILE)} (đọc chỉ đọc ${catalog.readAt ?? ''}); vân tay auto_error FB ${FINGERPRINT}.
-- Bảng duyệt: docs/CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_FULL_REVIEW.md. Anh duyệt bảng ở cuối (Q3, Q23) rồi sửa bộ sinh theo bảng TRƯỚC KHI apply.
--
-- Chỉ dữ liệu. Chính sách và luật chỉ engine v2 đọc; ${NEW_CODES.length} mã mới là 'engine v2' (bộ cũ bỏ qua).
-- Sửa đúng MỘT dòng auto_error của bộ cũ (anh chốt 17/11): FB04 err_fb_checkpoint bỏ khoá ${FB04.disable_action_codes.length} thao tác Facebook không thời hạn và bỏ tạm dừng
-- tài khoản, giữ chiến dịch về chờ xử lý và đăng nhập → checkpoint. Bộ cũ không có code phát FB04 nên khách không thấy khác. Các dòng khác không đổi.
-- Câu cho khách anh duyệt từng câu 17/11 (Q23): customer_title / customer_help của ${FB_ERRORS.length} mã Facebook (bộ cũ không đọc hai cột này: chỉ engine
-- và trang tra mã), chính sách engine dùng câu này cho lịch sử / tiến trình / ghi chú. Câu bộ cũ (noti_running_process, noti_campaign) giữ nguyên.
--   * Tắt ${SEED_ROWS.length} dòng seed_v495_error của mã Facebook (V495 dựng theo luật của Zalo: mã không có trạng thái lịch sử thì không ghi
--     lịch sử và trả data về hàng đợi; luôn đếm theo cột auto_error: lệch bộ cũ, phương án mục 5.3).
--   * ${policyRows.length} dòng chính sách theo (mã[, thao tác]) + ${guardRows.length} dòng chặn theo thao tác, source '${SOURCE}':
--       detail_mode = inherit: trạng thái lịch sử theo trạng thái block / bộ dựng cũ trả; tính lượt / chuỗi / data đi đâu theo chính sách
--       của trạng thái đó (V558 resolve_policy), trừ khi bộ cũ dùng cột auto_error (detail_mode khác NULL, hoặc kết bạn);
--       khoá thao tác, tạm dừng chiến dịch / tài khoản, trạng thái đăng nhập theo auto_error như seed V495;
--       comment lỗi sau khi data đã gửi thành công không cộng chuỗi (streak_after_delivery).
--   * ${RULES.length} luật phân loại (platform facebook, source '${SOURCE}').
-- Gỡ: rollback_v559_engine_facebook_policies.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_fp text; v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v559_%') THEN
      RAISE EXCEPTION 'V559 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  -- Cần V558: resolve_policy giải inherit như bộ cũ (dòng theo nhóm lỗi không áp cách đếm, trạng thái gửi lên đứng trước).
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_resolve_policy(text,bigint,text,text,text,text)'::regprocedure
                   AND p.prosrc LIKE '%v_inherit%') THEN
    RAISE EXCEPTION 'V559 cần V558 (resolve_policy giải inherit)';
  END IF;
  -- Đã apply rồi (V559 cũng sửa dòng FB04 nên phải kiểm trước vân tay, để chạy lại báo đúng lý do).
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = '${SOURCE}' AND is_active AND NOT is_delete)
     OR EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = '${SOURCE}' AND is_active) THEN
    RAISE EXCEPTION 'V559: đã có dòng ${SOURCE}';
  END IF;
  -- Danh mục FB của production phải đúng bản đã dựng bảng duyệt.
  SELECT ${FINGERPRINT_SQL} INTO v_fp
    FROM public.auto_error e WHERE e.error_type = 'external facebook' AND e.is_active AND NOT e.is_delete;
  IF v_fp IS DISTINCT FROM '${FINGERPRINT}' THEN
    RAISE EXCEPTION 'V559: auto_error Facebook đã đổi (vân tay %), đọc lại danh mục (read-catalog.cjs) và sinh lại', v_fp;
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies
   WHERE source = 'seed_v495_error' AND error_code IN (${fbCodeList}) AND action_code IS NULL AND is_active AND NOT is_delete;
  IF v_n <> ${SEED_ROWS.length} THEN RAISE EXCEPTION 'V559: % dòng seed_v495_error của mã Facebook đang bật, cần ${SEED_ROWS.length}', v_n; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code IN (${newCodeList}) AND error_type <> 'engine v2') THEN
    RAISE EXCEPTION 'V559: mã mới trùng mã không phải engine v2';
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

UPDATE public.auto_outcome_policies SET is_active = false, updated_at = now()
 WHERE source = 'seed_v495_error' AND error_code IN (${fbCodeList}) AND action_code IS NULL AND is_active AND NOT is_delete;

INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
${ruleRows.join(',\n')};

INSERT INTO public.auto_outcome_policies (error_code, error_class, action_code, detail_status_id, ${COLS.join(', ')}, description, source) VALUES
${[...policyRows, ...guardRows].join(',\n')};

-- Anh chốt 17/11: dòng FB04 của bộ cũ bỏ khoá thao tác và bỏ tạm dừng tài khoản (khoá rồi khách phải tự mở lại); giữ chiến dịch về chờ xử lý,
-- đăng nhập → checkpoint. Preflight đã so vân tay nên dòng đang đúng bản đã đọc.
UPDATE public.auto_error SET disable_action_codes = '{}'::text[], disable_action_mode = 'fixed_minutes', update_status_account = NULL, updated_at = now()
 WHERE error_code = 'err_fb_checkpoint' AND error_type = 'external facebook';

-- Anh duyệt từng câu 17/11 (Q23): câu cho khách và bước tiếp theo (NULL = không hiện) của mã Facebook. Không đụng câu của bộ cũ.
DO $cust$
DECLARE v_n integer;
BEGIN
  UPDATE public.auto_error e SET customer_title = v.title, customer_help = v.help
    FROM (VALUES
${customerRows.join(',\n')}
    ) AS v(error_code, title, help)
   WHERE e.error_code = v.error_code AND e.error_type = 'external facebook';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> ${FB_ERRORS.length} THEN RAISE EXCEPTION 'V559: câu cho khách: % dòng, cần ${FB_ERRORS.length}', v_n; END IF;
END $cust$;

DO $post$
DECLARE v_bad text; v_n integer;
BEGIN
  SELECT string_agg(issue || ':' || subject, ', ') INTO v_bad FROM public.aka_agent_engine_policy_lint;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V559 postflight lint: %', v_bad; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_checkpoint' AND cardinality(disable_action_codes) = 0
                   AND update_status_account IS NULL AND update_status_campaign = 'chờ xử lý' AND update_login_status = 'checkpoint') THEN
    RAISE EXCEPTION 'V559 postflight: dòng FB04 của bộ cũ chưa đúng như anh chốt';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE source = '${SOURCE}' AND is_active AND NOT is_delete;
  IF v_n <> ${POLICY_COUNT} THEN RAISE EXCEPTION 'V559 postflight: % dòng chính sách, cần ${POLICY_COUNT}', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_signal_rules WHERE source = '${SOURCE}' AND is_active;
  IF v_n <> ${RULES.length} THEN RAISE EXCEPTION 'V559 postflight: % luật, cần ${RULES.length}', v_n; END IF;
  -- Mọi luật trỏ tới mã đang bật.
  SELECT string_agg(r.error_code, ', ') INTO v_bad FROM public.auto_outcome_signal_rules r
   WHERE r.source = '${SOURCE}' AND NOT EXISTS (SELECT 1 FROM public.auto_error e WHERE e.error_code = r.error_code AND e.is_active AND NOT e.is_delete);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V559 postflight: luật trỏ tới mã không bật: %', v_bad; END IF;
  -- Mã mới không lọt vào bộ kiểm của bản cũ.
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code IN (${newCodeList})
               AND (error_type <> 'engine v2' OR cardinality(zalo_error_codes) > 0 OR counts_toward_limit OR counts_toward_bad_target)) THEN
    RAISE EXCEPTION 'V559 postflight: mã mới phải là engine v2, không có mã Zalo';
  END IF;
  -- Trả data về hàng đợi phải có đường dừng (khoá thao tác, tạm dừng chiến dịch ngay hoặc theo ngưỡng, dừng tài khoản, đổi đăng nhập).
  SELECT string_agg(p.error_code || '/' || coalesce(p.action_code, '*'), ', ') INTO v_bad
    FROM public.auto_outcome_policies p
    CROSS JOIN LATERAL (SELECT public.aka_agent_engine_resolve_policy(p.error_code, NULL, coalesce(p.action_code, 'fb_post_group'), NULL,
                                 'desktop', 'before_send') AS eff) x
   WHERE p.source = '${SOURCE}' AND p.error_code IS NOT NULL AND p.is_active AND NOT p.is_delete
     AND x.eff->>'target_effect' = 'requeue'
     AND coalesce(x.eff->>'campaign_effect', 'none') <> 'pause'
     AND coalesce(x.eff->>'run_effect', '') NOT IN ('stop_campaign', 'stop_account')
     AND coalesce(x.eff->>'login_effect', 'none') = 'none'
     AND coalesce(x.eff->'lock_action_codes', '[]'::jsonb) = '[]'::jsonb;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V559 postflight: trả data về hàng đợi mà không có đường dừng: %', v_bad; END IF;
  -- Zalo không đổi: không dòng nào của V559 khớp thao tác hay mã Zalo.
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = '${SOURCE}' AND action_code LIKE 'zalo\\_%') THEN
    RAISE EXCEPTION 'V559 postflight: có chính sách cho thao tác Zalo';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V559: xoá chính sách và luật ${SOURCE}, bật lại dòng seed_v495_error của mã Facebook, tắt ${NEW_CODES.length} mã mới (không xoá dòng auto_error vì
-- lịch sử có thể đã tham chiếu), trả dòng FB04 của bộ cũ về như trước (khoá thao tác, tạm dừng tài khoản). SINH TỪ scripts/build-v559-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DELETE FROM public.auto_outcome_policies WHERE source = '${SOURCE}';
DELETE FROM public.auto_outcome_signal_rules WHERE source = '${SOURCE}';
UPDATE public.auto_outcome_policies SET is_active = true, updated_at = now()
 WHERE source = 'seed_v495_error' AND error_code IN (${fbCodeList}) AND action_code IS NULL AND NOT is_active AND NOT is_delete;
UPDATE public.auto_error SET is_active = false, is_delete = true
 WHERE error_type = 'engine v2' AND error_code IN (${newCodeList});
-- Trả câu cho khách của mã Facebook về như trước V559 (chỉ dòng còn đúng câu V559 ghi).
UPDATE public.auto_error e SET customer_title = v.old_title, customer_help = v.old_help
  FROM (VALUES
${customerOldRows.join(',\n')}
  ) AS v(error_code, old_title, old_help, new_title)
 WHERE e.error_code = v.error_code AND e.error_type = 'external facebook' AND e.customer_title IS NOT DISTINCT FROM v.new_title;
-- Trả dòng FB04 của bộ cũ về như trước V559 (chỉ khi chưa ai sửa tiếp sau V559).
UPDATE public.auto_error SET disable_action_codes = ${FB04_CODES_SQL}, disable_action_mode = ${lit(FB04.disable_action_mode)},
  update_status_account = ${lit(FB04.update_status_account)}, updated_at = now()
 WHERE error_code = 'err_fb_checkpoint' AND error_type = 'external facebook' AND cardinality(disable_action_codes) = 0 AND update_status_account IS NULL;

DO $post$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(issue || ':' || subject, ', ') INTO v_bad FROM public.aka_agent_engine_policy_lint;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Gỡ V559 postflight lint: %', v_bad; END IF;
END $post$;

COMMIT;
`

// ------------------------------------------------------------------------------------------------ bảng duyệt
// Ai phát mã hôm nay (phương án mục 5.1, đọc code block DB + app 16/11/2026).
const PRODUCERS = {
  err_limit_waiting_message: 'block `fb_send_message` (38) ném lỗi có mã; bộ cũ còn đoán theo câu lỗi',
  err_group_post_frequency_limit: 'bộ cũ đoán theo câu lỗi ("giới hạn tần suất bạn đăng bài")',
  err_comment_frequency_limit: 'bộ cũ đoán theo câu lỗi ("giới hạn tần suất comment")',
  err_fb_checkpoint: 'bộ cũ: chưa có; engine: trang chạy ngầm ở trang xác minh (Q6)',
  err_fb_add_friend_unavailable: 'block `fb_add_friend` (39)',
  err_fb_comment_unavailable_post_pending: 'block `fb_comment_current_post` (2616, V472)',
  err_fb_comment_unavailable_comment_disabled: 'block 2616 (V472)',
  err_fb_comment_unavailable_post_not_found: 'block 2616 (V472)',
  err_fb_comment_unavailable_not_member: 'block 2616 (V472)',
  err_fb_comment_box_not_found: 'block 2616 (V472)',
  err_fb_composer_editor_not_found: 'block `fb_open_composer` (27)',
  err_fb_group_composer_editor_not_found: 'block `fb_open_composer` (27)'
}
// Quyết định của anh cho các dòng từng cần chốt (17/11). Cả bốn đều trùng bản nháp nên chính sách không đổi.
const ASK = {
  err_fb_composer_editor_not_found: 'Anh chốt 17/11: như bộ cũ. Từ V459 (04/11) đăng nhóm không còn ra mã này: không thấy ô đăng trong nhóm (kể cả nhóm mua bán, ô "Bạn đang bán gì?") là FB40. 46 chiến dịch đăng nhóm đang dừng vì "Không tìm thấy ô đăng bài" đều dừng 02/10–04/11, trước V459. Nay chỉ còn ở đăng trang cá nhân.',
  err_fb_group_composer_editor_not_found: 'Anh chốt 17/11: nhóm mua bán / nhóm không có ô đăng bài thì chỉ bỏ qua data, không đếm gì: đúng như dòng này từ V459, engine giữ y.',
  err_fb_comment_box_not_found: 'Anh chốt 17/11: như bộ cũ.',
  err_group_post_frequency_limit: 'Anh chốt 17/11: như bộ cũ (tạm dừng chiến dịch ngay để khách giảm tốc độ rồi bấm Tiếp tục).',
  err_comment_frequency_limit: 'Anh chốt 17/11: như bộ cũ.',
  err_fb_group_cannot_post_join_pending: 'Anh chốt 17/11: như bộ cũ. Chưa có code nhận ra (hôm nay trường hợp này ra FB40); khi viết code nhận ra thì duyệt lại.',
  err_fb_post_not_confirmed: 'Anh chốt 17/11: như bộ cũ. Chưa có code nhận ra (hôm nay ra dòng "lỗi" "Form đăng bài chưa đóng sau 60 giây"); khi viết code nhận ra thì duyệt lại.',
  err_fb_checkpoint: 'Anh chốt 17/11: V559 sửa luôn dòng của bộ cũ: bỏ khoá 11 thao tác và bỏ tạm dừng tài khoản (khoá rồi khách phải tự mở lại), giữ chiến dịch về chờ xử lý và đăng nhập → checkpoint. Bộ cũ không phát mã này nên khách không thấy khác.'
}

const EFFECT_STATUS_ROWS = catalog.policies.filter(p => p.status_id != null && !p.error_code && !p.error_class && !p.campaign_action_id && !p.runtime_target)
function statusPolicyText(action) {
  const pick = code => {
    const s = statusByCode(code)
    const row = EFFECT_STATUS_ROWS.find(p => p.status_id === s?.id && p.action_code === action) ?? EFFECT_STATUS_ROWS.find(p => p.status_id === s?.id && !p.action_code)
    return row ? `${s.statusValue}: ${row.quota_effect === 'count' ? 'tính lượt' : 'không tính lượt'}, ${row.target_streak_effect === 'increment' ? 'cộng chuỗi' : row.target_streak_effect === 'reset' ? 'đặt lại chuỗi' : 'không cộng chuỗi'}` : null
  }
  return ['campaign_detail_failed', 'campaign_detail_error', 'campaign_detail_not_found'].map(pick).filter(Boolean).join('; ')
}
const ACTION_NAMES = Object.fromEntries(catalog.fbActions.map(a => [a.code, a.name]))
function describe(fields) {
  const parts = []
  if (fields.detail_mode === 'inherit') parts.push(`ghi lịch sử theo trạng thái block trả${fields.detail_status ? ` (không gửi trạng thái: "${statusByCode(fields.detail_status)?.statusValue}")` : ''}`)
  else if (fields.detail_mode === 'write') parts.push(`ghi "${statusByCode(fields.detail_status)?.statusValue ?? '?'}"`)
  else if (fields.detail_mode === 'suppress') parts.push('không ghi lịch sử')
  if (fields.quota_effect || fields.target_streak_effect) {
    parts.push(`${fields.quota_effect === 'count' ? 'tính lượt' : 'không tính lượt'}, ${fields.target_streak_effect === 'increment' ? 'cộng chuỗi data lỗi' : 'không cộng chuỗi'}`)
  } else if (fields.detail_mode === 'inherit') parts.push('đếm theo trạng thái')
  const target = fields.target_effect ?? (fields.detail_mode === 'inherit' ? 'complete' : null)
  if (target) parts.push(target === 'complete' ? 'data hoàn thành' : target === 'requeue' ? 'data về hàng đợi' : target === 'hold' ? 'data tạm dừng' : `data: ${target}`)
  if (fields.streak_threshold) parts.push(`${fields.streak_threshold} lần liền thì ${fields.campaign_effect === 'pause' ? 'tạm dừng chiến dịch' : 'chiến dịch về chờ'}`)
  else if (fields.campaign_effect === 'pause') parts.push('tạm dừng chiến dịch ngay')
  else if (fields.campaign_effect === 'hold') parts.push('chiến dịch về chờ xử lý (bộ cũ chạy lại ngay lượt quét sau)')
  if (fields.account_effect === 'pause') parts.push('tạm dừng tài khoản')
  if (fields.login_effect && fields.login_effect !== 'none') parts.push(`trạng thái đăng nhập → ${fields.login_effect === 'checkpoint' ? 'checkpoint' : 'chưa đăng nhập'}`)
  if ((fields.lock_action_codes ?? []).length) {
    const minutes = fields.lock_minutes ? `${fields.lock_minutes >= 60 && fields.lock_minutes % 60 === 0 ? `${fields.lock_minutes / 60} giờ` : `${fields.lock_minutes} phút`}` : 'không thời hạn'
    parts.push(`khoá ${fields.lock_action_codes.length > 3 ? `${fields.lock_action_codes.length} thao tác FB` : fields.lock_action_codes.map(c => ACTION_NAMES[c] ?? c).join(', ')} ${minutes}`)
  }
  if (fields.run_effect === 'end_unit') parts.push('dừng lượt sau data này')
  if (fields.run_effect === 'stop_account') parts.push('dừng lượt của tài khoản')
  return parts.join('; ')
}
/** Hành vi bộ cũ hôm nay của một mã (actionResultRuntime + ActionStatusCatalog + applyRuntimeErrorPolicy), để so cột nháp. */
function legacyBehaviour(e) {
  return describe(legacyDraft(e))
}
const esc = text => String(text ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')
const reviewRows = FB_ERRORS.map(e => {
  const draft = DECIDED[e.error_code] ? { ...legacyDraft(e), ...DECIDED[e.error_code] } : legacyDraft(e)
  const [title, help] = CUSTOMER[e.error_code] ?? [e.customer_title, '']
  const seed = SEED_ROWS.find(p => p.error_code === e.error_code)
  const seedFields = seed ? { ...seed, detail_status: statusById(seed.detail_status_id)?.code ?? null } : null
  const legacyText = legacyBehaviour(e)
  const draftText = describe(draft) === legacyText ? '= bộ cũ' : describe(draft)
  return `| ${e.public_code} | \`${e.error_code}\` | ${esc(PRODUCERS[e.error_code] ?? 'chưa có code phát (danh mục V346)')} | ${esc(legacyText)} | ${esc(seedFields ? describe(seedFields) : '-')} | ${esc(draftText)}${DECIDED[e.error_code] ? ` **(${DECIDED[e.error_code].why.split(':')[0]})**` : ''} | ${esc(title)} | ${esc(help)} | ${esc(ASK[e.error_code] ?? '')} |`
})
const newRows = NEW_CODES.map(([code, pub, , , title, help]) => {
  const fields = POLICIES.find(p => p[0] === code && p[1] === null)[2]
  const when = { err_engine_fb_action_failed: 'dòng "thất bại / lỗi / không tồn tại" không mã của bộ dựng cũ (luật `status:*`)',
    err_engine_fb_logged_out: 'trang chạy ngầm ở trang đăng nhập khi block lỗi', err_engine_fb_ui_not_ready: 'thao tác trên trang lỗi trước mốc gửi (luật `block *`)',
    err_engine_fb_no_history: 'block chạy xong mà bộ dựng lịch sử của bộ cũ không ghi dòng nào: Like khi comment seeding, comment tự bỏ qua (bài chờ duyệt), comment seeding không có bài hợp điều kiện' }[code]
  const legacy = { err_engine_fb_action_failed: 'như cột nháp (bộ cũ ghi dòng theo trạng thái, đếm theo trạng thái)',
    err_engine_fb_logged_out: 'block lỗi → SYS99: ghi "lỗi", cộng chuỗi; AutoCheck đổi trạng thái đăng nhập',
    err_engine_fb_ui_not_ready: 'SYS99: ghi "lỗi", không tính lượt, cộng chuỗi, 4 lần liền thì tạm dừng',
    err_engine_fb_no_history: 'không ghi lịch sử, không in tiến trình, không tính lượt, không cộng chuỗi, data hoàn thành' }[code]
  const ask = { err_engine_fb_ui_not_ready: 'Anh chốt 17/11: như bộ cũ.' }[code] ?? ''
  return `| ${pub} | \`${code}\` (mới) | ${esc(when)} | ${esc(legacy)} | - | ${esc(describe(fields))} | ${esc(title)} | ${esc(help)} | ${esc(ask)} |`
})
const ruleTable = RULES.map(([phase, kind, pattern, action, code, note]) => {
  const err = catalog.fbErrors.find(e => e.error_code === code)
  const pub = err?.public_code ?? NEW_CODES.find(r => r[0] === code)?.[1] ?? ''
  return `| ${phase ?? 'mọi pha'} | ${kind} | \`${esc(pattern)}\`${action ? ` (${action})` : ''} | ${pub} \`${code}\` | ${esc(note)} |`
})

const review = `# Bảng duyệt mã lỗi Facebook cho engine v2 (anh duyệt xong 17/11/2026)

> **Hành vi đã chốt 17/11** (cột "Anh chốt" ghi quyết định): không dòng nào đổi chính sách engine so với bản nháp giữ hành vi bộ cũ;
> riêng dòng FB04 của bộ cũ được sửa luôn (bỏ khoá thao tác, bỏ tạm dừng tài khoản). **Câu cho khách / bước tiếp theo: anh duyệt từng câu 17/11 (Q23).**
>
> Anh chốt (Q3, Q23; 16/11 tối): duyệt bảng này ở cuối, sau khi code xong cả 13 loại, trước khi apply migration chính sách
> và bật tổ chức thử. Bảng và \`migrations/migration_v559_engine_facebook_policies.sql\` sinh cùng lúc bằng \`node scripts/build-v559-sql.cjs\`
> từ danh mục production đọc chỉ đọc (\`node scripts/engine-v2-facebook/read-catalog.cjs\`, bản hiện tại: ${path.relative(ROOT, CATALOG_FILE)},
> đọc ${catalog.readAt ?? '?'}, vân tay auto_error FB \`${FINGERPRINT}\`). Anh chốt dòng nào thì em sửa bộ sinh theo dòng đó rồi sinh lại.
>
> Phương án: [CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_PLAN.md](CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_PLAN.md) mục 5. Kiểm: \`node scripts/engine-v2-facebook/policy-parity-smoke.cjs\`
> (so từng cặp mã × thao tác × trạng thái của bản nháp với chính \`ActionStatusCatalog.resolve\` của bộ cũ).

## Cách đọc

- **Bộ cũ hôm nay**: hành vi của Desktop bản hiện tại khi block trả mã này (actionResultRuntime.ts:139-185, ActionStatusCatalog.resolve,
  applyRuntimeErrorPolicy). Bộ cũ ghi trạng thái lịch sử theo trạng thái block trả (trừ \`override\`), và chỉ đếm theo cột của auto_error khi
  \`detail_mode\` khác NULL hoặc thao tác là kết bạn; còn lại đếm theo chính sách của trạng thái (${statusPolicyText(null)}).
- **Seed V495**: chính sách engine đang có trên production (dựng theo luật của Zalo). V559 tắt các dòng này.
- **Nháp V559**: chính sách engine sau V559. Bằng bộ cũ, trừ dòng ghi **Q6** / **Q20** (anh đã chốt).
- **Câu cho khách / Bước tiếp theo**: anh duyệt từng câu 17/11 (Q23). V559 ghi vào \`customer_title\` / \`customer_help\` (bộ cũ không đọc
  hai cột này) và chính sách engine dùng câu lỗi cho lịch sử hành động, tiến trình, ghi chú data; ghi chú chiến dịch khi mã làm chiến dịch dừng /
  chờ là "câu lỗi (mã). bước tiếp theo", dừng theo chuỗi data lỗi thì V558 nối bước tiếp theo của mã FB sau câu dừng. Bộ cũ giữ câu cũ
  (\`noti_running_process\` / \`noti_campaign\`). Bốn nguyên tắc anh chốt: bước tiếp theo chỉ hiện khi khách cần làm gì (trống = không hiện);
  chữ dễ hiểu với người bình thường; câu lỗi đã tự rõ thì không cần bước tiếp theo; bước tiếp theo không đoán nguyên nhân.
- Comment lỗi sau khi data đã đăng / gửi thành công: không cộng chuỗi data lỗi, như bộ cũ (dòng chặn theo thao tác \`fb_comment\`).
- **"Áp cả bộ cũ"** (sửa luôn auto_error như V472, mọi Desktop đang chạy bộ cũ đổi ngay): chỉ FB04 (anh chốt 17/11), các dòng khác không.

## 1. Mã Facebook đang có (${FB_ERRORS.length})

| Mã | error_code | Ai phát hôm nay | Bộ cũ hôm nay | Seed V495 (engine hôm nay) | Nháp V559 | Câu cho khách (anh duyệt) | Bước tiếp theo (anh duyệt; trống = không hiện) | Anh chốt |
|---|---|---|---|---|---|---|---|---|
${reviewRows.join('\n')}

## 2. Mã mới (engine v2, bộ cũ bỏ qua)

| Mã | error_code | Khi nào | Bộ cũ tương ứng | Seed V495 | Nháp V559 | Câu cho khách (anh duyệt) | Bước tiếp theo (anh duyệt; trống = không hiện) | Anh chốt |
|---|---|---|---|---|---|---|---|---|
${newRows.join('\n')}

## 3. Mã engine dùng chung cho thao tác Facebook

| Mã | Khi nào | Nháp V559 |
|---|---|---|
| SYS99 \`err_undefined\` | block ném lỗi / trả \`{ ok: false }\` không khớp luật nào, cả sau mốc gửi (như bộ cũ) | giữ chính sách đang có: ghi "lỗi", không tính lượt, cộng chuỗi, bỏ bước còn lại, 4 lần liền thì tạm dừng; nhắn inbox Page 8 lần liền (bộ cũ tự chạy lại một lần). **Anh chốt 17/11: giữ dòng "lỗi".** Khác bộ cũ có chủ ý: phát lại lịch sử thật thấy bộ cũ chỉ ghi dòng "lỗi" khi block mốc gửi lỗi; block khác ném lỗi (gõ nội dung, tệp media, dán HTML…) thì bộ cũ không ghi dòng nào, chỉ ghi câu lỗi vào ghi chú data và cộng chuỗi. Engine ghi thêm dòng "lỗi" (SYS99 / FB44, không tính lượt, cộng chuỗi) để khách thấy lỗi trong lịch sử. |
| SYS04 \`err_runtime_browser\` | cửa sổ chạy ngầm chết / block treo **trước** mốc gửi (Q20) | ${esc(describe(POLICIES.find(p => p[0] === 'err_runtime_browser')[2]))} |
| UNK01 \`err_engine_unknown_delivery\` | block treo / cửa sổ chết **sau** dấu "sắp gửi" (Q20) | giữ chính sách đang có: ghi "thất bại", tính lượt nếu đã gửi, không cộng chuỗi, data hoàn thành, không gửi lại |
| SYS02 \`err_engine_interrupted_while_sending\` | dừng / thoát app khi mốc đã ghi dấu mà chưa có kết quả | giữ chính sách đang có (không rõ kết quả, không gửi lại) |
| RUN01 \`err_engine_cancelled\` | dừng / thoát app trước mốc gửi | giữ chính sách đang có (data về hàng đợi, không tính lỗi) |
| SYS07 \`err_engine_no_outcome\` | workflow chạy xong mà không báo kết quả nào | giữ chính sách đang có |
| SYS03 \`err_system_block_load\` | thiếu workflow / block bản engine, bước gửi khai thao tác lạ | giữ chính sách đang có (về hàng đợi, dừng lượt) |
| CFG01, CFG02, CFG14–CFG16 | media / cấu hình chiến dịch sai (kiểm đầu lượt) | giữ chính sách đang có (tạm dừng chiến dịch một lần) |
| NET01, DB01 | mất mạng / không gọi được máy chủ của mình | giữ chính sách đang có |

## 4. Luật phân loại tín hiệu Facebook (${RULES.length})

| Pha | Loại tín hiệu | Mẫu | Mã | Ghi chú |
|---|---|---|---|---|
${ruleTable.join('\n')}

Mã block trả trong \`actionResult.errorCode\` dùng thẳng, không qua luật. Tín hiệu không khớp luật nào: SYS99 (như bộ cũ), và được đếm vào
\`auto_outcome_unmatched\` để xem bằng \`node scripts/engine-v2-facebook/trace.cjs --health\`.

## 5. Quyết định đã chốt áp sẵn trong bản nháp

- **Q6**: checkpoint (FB04) và đăng xuất (FB43) chỉ đổi trạng thái đăng nhập; data chưa tới mốc gửi về hàng đợi, đã tới mốc thì chốt như Q2;
  không khoá thao tác, không tạm dừng tài khoản hay chiến dịch. Dòng auto_error FB04 của bộ cũ chưa đổi (chờ anh chọn "áp cả bộ cũ").
- **Q20**: block treo / cửa sổ chạy ngầm chết: chưa tới mốc gửi → SYS04 (data về hàng đợi, 4 lần liền thì tạm dừng chiến dịch); đã có dấu
  "sắp gửi" → UNK01 (không rõ kết quả, không gửi lại).
`

module.exports = { FB_CODES, NEW_CODES, RULES, POLICIES, GUARDS, FINGERPRINT, FINGERPRINT_SQL, SOURCE, legacyDraft, migration, rollback, review, POLICY_COUNT }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations/migration_v559_engine_facebook_policies.sql'), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v559_engine_facebook_policies.sql'), rollback)
  fs.writeFileSync(path.join(ROOT, 'docs/CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_FULL_REVIEW.md'), review)
  console.log(`V559: ${POLICY_COUNT} dòng chính sách (tắt ${SEED_ROWS.length} dòng seed), ${RULES.length} luật, ${NEW_CODES.length} mã mới; vân tay ${FINGERPRINT};`
    + ` migration ${md5(migration)}, rollback ${md5(rollback)}`)
}
