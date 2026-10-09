// Evidence, not the Automation picker, determines the initial policy matrix.
const source = {
  desktop: 'src/main/services/campaignScheduler.ts',
  writer: 'src/main/data/repositories/campaignRepository.ts#createCampaignDetail',
  report: 'src/main/data/repositories/reportRepository.ts',
  chat: 'akaAgentChatApi/apps/system-worker/src/zaloCampaignExecutor.ts',
  chatWriter: 'akaAgentChatApi/packages/database/src/campaignRuntimeRepository.ts#createDetail'
}
const tuple = (report_group, counts_toward_limit, bad_target_effect, reset_error_streak, input_effect = 'complete') =>
  ({ report_group, counts_toward_limit, bad_target_effect, reset_error_streak, input_effect })
const rows = []
function add(status, action, decisions, description, evidence, verifiedActions) {
  rows.push({ status_code: `campaign_detail_${status}`, action_code: action, ...decisions,
    description, evidence, verified_actions: verifiedActions || (action ? [action] : []) })
}
add('success', null, tuple('success', true, 'reset', true),
  'Thao tác chính đã được xác nhận thành công: tính lượt, đặt lại chuỗi lỗi; chốt input sau khi tổng hợp các hành động. Gửi yêu cầu thành công không cần chờ bên nhận chấp thuận.',
  [source.desktop + '#createZaloSuccessDetail/logFacebookFriendMilestone/emailSendMessage', source.writer, source.chat + '#runStep'],
  ['fb_add_friend', 'fb_join_group', 'fb_post_group', 'fb_post_my_profile', 'fb_post_page', 'fb_comment', 'fb_message_friend', 'fb_message_stranger', 'fb_message_page_inbox_customer', 'fb_like_post', 'fb_group_invite', 'zalo_add_friend', 'zalo_add_group_member', 'zalo_join_group_link', 'zalo_message_friend', 'zalo_message_stranger', 'zalo_message_group', 'zalo_find_phone_user', 'email_send'])
add('failed', null, tuple('failure', true, 'increment', true),
  'Thao tác thất bại thông thường: ghi thất bại và tính lượt theo writer hiện có. Policy lỗi và guard gửi một phần/hành động phụ được kết hợp riêng; không tự phát lại thao tác.',
  [source.desktop + '#recordMilestoneSummary/emailSendMessage', source.writer, source.chatWriter],
  ['fb_post_group', 'fb_post_my_profile', 'fb_post_page', 'fb_comment', 'fb_message_friend', 'fb_message_stranger', 'fb_join_group', 'zalo_message_friend', 'zalo_message_stranger', 'zalo_message_group', 'email_send'])
add('error', null, tuple('failure', false, 'increment', false),
  'Lỗi của kết quả thông thường: báo cáo thất bại, không tính lượt mặc định. Không thay cách diễn giải detail_status NULL, khóa/dừng hoặc requeue của policy lỗi legacy.',
  [source.desktop + '#recordMilestoneSummary/logCampaignMilestones', source.writer],
  ['fb_post_group', 'fb_post_my_profile', 'fb_post_page', 'fb_comment', 'fb_message_friend', 'fb_message_stranger', 'fb_message_page_inbox_customer'])
add('skipped', null, tuple('skipped', false, 'ignore', false),
  'Bỏ qua mà không thực hiện thao tác mới: không tính lượt và không thay chuỗi target lỗi.',
  [source.desktop + '#logFacebookFriendMilestone (legacy_skipped)'], ['fb_add_friend'])
for (const [status, actions, evidence] of [
  ['already_friend', ['fb_add_friend', 'zalo_add_friend'], 'logFacebookFriendMilestone / err_zalo_already_friend'],
  ['invitation_sent', ['fb_add_friend', 'zalo_add_friend'], 'logFacebookFriendMilestone / err_zalo_friend_request_sent'],
  ['already_member', ['zalo_add_group_member'], 'err_zalo_group_member_already_exists'],
  ['joined', ['fb_join_group', 'zalo_join_group_link'], 'already_joined branch']
]) add(status, null, tuple('skipped', false, 'ignore', false),
  'Quan hệ hoặc yêu cầu đã tồn tại từ trước; giữ mã trạng thái chính riêng. Không có thao tác mới để tính lượt; không thay chuỗi target lỗi.',
  [source.desktop + '#' + evidence], actions)
add('not_found', null, tuple('failure', false, 'ignore', false),
  'Không tồn tại: nhóm báo cáo thất bại; mặc định không tính lượt và không thay chuỗi target lỗi. Lượt tra cứu Zalo vẫn theo auto_error; mời nhóm Facebook có policy riêng.',
  [source.desktop + '#emailSendMessage / fb_message_page_inbox_customer', source.report], ['email_send', 'fb_message_page_inbox_customer'])
add('not_found', 'fb_group_invite', tuple('skipped', false, 'ignore', false),
  'Không tìm thấy đối tượng để mời nhóm Facebook được báo cáo bỏ qua theo report hiện tại.', [source.report + '#FACEBOOK_GROUP_INVITE_SKIPPED_DETAIL_STATUSES'])
add('error', 'fb_join_group', tuple('failure', true, 'increment', true),
  'Nhánh lỗi tham gia nhóm Facebook hiện tính lượt khi outcome không phải already_joined; bảo toàn khác biệt này.',
  [source.desktop + '#FACEBOOK_JOIN_GROUP_ACTION_ID: shouldCountAction = outcome !== already_joined', source.writer])
for (const action of ['zalo_tag_contact', 'zalo_change_alias']) {
  for (const status of ['success', 'failed', 'error']) add(status, action,
    tuple(status === 'success' ? 'success' : 'failure', false, 'ignore', false),
    'Hành động phụ gắn tag/đổi tên: không tính lượt, không tăng hoặc reset bộ đếm target lỗi; giữ kết quả và xử lý lỗi tương ứng.',
    [source.desktop + '#isAuxiliaryZaloTargetAction', source.chat + '#isAuxiliaryZaloTargetAction', source.chatWriter])
}
const newStatuses = [
  { code: 'campaign_detail_skipped', name: 'Bỏ qua', status_key: 'skipped', status_value: 'bỏ qua', description: 'Không thực hiện một thao tác mới. Policy trạng thái chính quyết định cách đếm.', is_terminal: true, sort_order: 200 },
  { code: 'campaign_detail_post_pending', name: 'Chờ duyệt bài', status_key: 'post_pending', status_value: 'chờ duyệt bài', description: 'Quan sát sau đăng bài thành công: có bằng chứng đang chờ duyệt. Khi dùng làm subStatusCode chỉ phục vụ báo cáo/Automation, không thay policy chính.', is_terminal: false, sort_order: 210 },
  { code: 'campaign_detail_post_visible', name: 'Đã hiển thị bài', status_key: 'post_visible', status_value: 'đã hiển thị bài', description: 'Quan sát xác nhận bài đã hiển thị; không suy ra từ việc chưa phát hiện chờ duyệt. Khi dùng làm subStatusCode không thay policy chính.', is_terminal: false, sort_order: 220 }
]
module.exports = { rows, newStatuses, source }
