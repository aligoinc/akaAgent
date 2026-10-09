"""Extract the supplied workbooks read-only and build the v346 review catalog.

Run with the bundled Python (openpyxl). Does not connect to the database.
"""
import hashlib
import json
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'migrations/snapshots/fb-email-policies-v346'
SOURCE = Path('/Users/lequangnhut/Downloads')
FILES = ['Danh_sach_loi_Facebook_auto_28092026.xlsx',
         'FACEBOOK_ERROR_HANDLING_20260928.xlsx', 'akaBiz_Email_Bang_Quan_Ly_Loi.xlsx']
books = [openpyxl.load_workbook(SOURCE / f, read_only=True, data_only=True) for f in FILES]
first = list(books[0]['Danh sách lỗi FB'].values)
second = list(books[1]['1. Danh sách lỗi FB'].values)
email = list(books[2]['Cấu hình auto_error'].values)
before = json.loads((DEST / 'before.json').read_text())
existing = {r['row']['error_code'] for r in before['rows']}
fb_actions = ['fb_add_friend', 'fb_comment', 'fb_group_invite', 'fb_join_group',
              'fb_like_post', 'fb_message_friend', 'fb_message_page_inbox_customer',
              'fb_message_stranger', 'fb_post_group', 'fb_post_my_profile', 'fb_post_page']
catalog = []


def source_row(index, sheet, number, row, selected):
    return {'file': FILES[index], 'sheet': sheet, 'row': number,
            'cells': {openpyxl.utils.get_column_letter(i + 1): row[i] for i in selected if row[i] is not None}}


def fb_sources(a, b):
    result = []
    for number in a:
        result.append(source_row(0, 'Danh sách lỗi FB', number, first[number - 1], [0, 2, 3, 4, 5, 6, 7, 8]))
    for number in b:
        result.append(source_row(1, '1. Danh sách lỗi FB', number, second[number - 1], [0, 1, 2, 3, 6, 7, 8, 9]))
    return result


def add(code, title, sources, meaning, *, aliases=(), note='', kind='external facebook', **fields):
    assert code not in existing, code
    assert code not in [x['policy']['error_code'] for x in catalog], code
    policy = dict(error_code=code, error_type=kind, error_name=title, error_desc='',
                  error_element=None, noti_running_process=title, noti_campaign=title,
                  update_status_account=None, update_status_campaign=None, update_login_status=None,
                  disable_action_codes=[], disable_action_mode='fixed_minutes', time_disable_actions=None,
                  count_consecutive_errors=None, detail_status=None, counts_toward_limit=False,
                  counts_toward_bad_target=False, zalo_error_codes=[], zalo_action_codes=[],
                  disable_action_days=None, disable_action_time=None, is_active=True, is_delete=False)
    policy.update(fields)
    descriptions = [f'Phạm vi: {meaning}']
    if aliases:
        descriptions.append('Tên/nhóm tương đương trong tài liệu (không thêm policy trùng): ' + ', '.join(aliases))
    if note:
        descriptions.append('Giới hạn cấu hình / cần triển khai sau: ' + note)
    descriptions.append('v346 chỉ bổ sung danh mục DB. Nhận diện mã và hành vi chưa được tích hợp vào runtime; is_active=true không tự nhận diện lỗi mới.')
    for source in sources:
        descriptions.append(f"Nguồn: {source['file']} / {source['sheet']} / dòng {source['row']}")
    policy['error_desc'] = '\n\n'.join(descriptions)
    catalog.append({'policy': policy, 'sources': sources, 'aliases': list(aliases), 'implementation_notes': note})


target = dict(detail_status='thất bại')
pending = dict(update_status_campaign='chờ xử lý')

add('err_fb_checkpoint', 'Facebook yêu cầu xác minh tài khoản', fb_sources([3], [10]),
    'URL/checkpoint hoặc yêu cầu xác minh danh tính đã được xác nhận.',
    update_status_account='tạm dừng', update_login_status='checkpoint', **pending,
    disable_action_codes=fb_actions, disable_action_mode='indefinite',
    note='Phát hiện checkpoint trước cookie; mở lại sau xác minh và giảm hạn mức cần runtime. Chưa tạo trạng thái hoặc timer mới.')
add('err_fb_feature_blocked', 'Facebook tạm chặn một tính năng', fb_sources([], [11]),
    'Thông báo chặn tính năng đã được xác nhận; chỉ tác động hành động phát sinh.', **pending,
    note='Tài liệu nêu 24–72 giờ hoặc thời hạn Facebook thông báo, chưa có giá trị duy nhất. Chưa gán thời gian/disable_action_codes: cần action phát sinh và thời hạn thực tế; không khóa tất cả Facebook.')
add('err_fb_identity_switch_failed', 'Không chuyển được sang danh tính Facebook cần dùng', fb_sources([4], [33]),
    'Không chọn được Page/profile yêu cầu, chưa thực hiện hành động.', aliases=['err_fb_identity_switch (chuyển sang)'], **pending,
    note='Thử lại một lần, xác minh ID/danh tính và trả input cần runtime.')
add('err_fb_identity_restore_failed', 'Không khôi phục được danh tính Facebook ban đầu', fb_sources([4], [33]),
    'Không trở về danh tính gốc sau lượt chạy; các chiến dịch sau có thể dùng nhầm danh tính.',
    aliases=['err_fb_identity_switch (khôi phục)'], update_status_account='tạm dừng', **pending,
    note='Dừng các chiến dịch của tài khoản và yêu cầu kiểm tra trình duyệt; không tự thử lại.')

for suffix, title, meaning in [
    ('token_missing', 'Thiếu phiên truy cập Facebook Business', 'Không lấy được user access token.'),
    ('no_page_token', 'Thiếu quyền hoặc token đăng bài lên Page', 'Không có page access token hoặc mất quyền Page cụ thể.')]:
    add('err_fb_page_permission_' + suffix, title, fb_sources([5], [27]), meaning,
        aliases=['err_fb_page_permission', 'err_fb_page_token_invalid'], **pending,
        note='Khóa theo cặp tài khoản–Page tới khi xác thực lại chưa có cột biểu diễn. Không đổi thành khóa toàn tài khoản; disable_action_codes để rỗng.')
add('err_fb_page_permission_api_error', 'Facebook Graph API tạm thời không xử lý được yêu cầu', fb_sources([5], [27]),
    'Lỗi API tạm thời như unknown error/reduce amount of data; không phải mất quyền Page.', **pending,
    note='Thử lại sau 5 phút, tối đa 3 lần là đề xuất trong tài liệu, chỉ lưu mô tả; không dùng thời gian khóa action để thay bộ đếm retry. Nếu chưa rõ đã đăng thì xác minh trước khi thử lại.')

for suffix, title, meaning, detail in [
    ('not_member', 'Chưa là thành viên nhóm Facebook', 'Chưa tham gia nhóm; chưa đủ điều kiện đăng.', 'thất bại'),
    ('join_pending', 'Đang chờ duyệt tham gia nhóm Facebook', 'Yêu cầu tham gia nhóm chưa được duyệt.', 'thất bại'),
    ('admin_only', 'Nhóm Facebook chỉ cho quản trị viên đăng bài', 'Tài khoản không có quyền đăng trong nhóm.', 'thất bại'),
    ('unavailable', 'Nhóm Facebook không khả dụng', 'Nhóm bị xóa, không tồn tại hoặc tài khoản không thể truy cập.', 'không tồn tại')]:
    add('err_fb_group_cannot_post_' + suffix, title, fb_sources([9], [8]), meaning,
        aliases=['err_fb_group_cannot_post'], detail_status=detail,
        note='Lỗi mục tiêu: chạy tiếp, không khóa tài khoản. Tự tham gia nếu được cấu hình và cache account–group 7–14 ngày cần runtime; không tạo trạng thái detail mới.')

for suffix, title, meaning, detail in [
    ('post_pending', 'Bài Facebook đang chờ duyệt nên chưa bình luận được', 'Chưa xác nhận bài hiển thị để bình luận.', 'thất bại'),
    ('comment_disabled', 'Bài Facebook đã tắt bình luận', 'Bài viết cụ thể không cho bình luận.', 'thất bại'),
    ('post_not_found', 'Không tìm thấy bài Facebook để bình luận', 'Bài không còn hoặc không có bài tại vị trí yêu cầu.', 'không tồn tại'),
    ('not_member', 'Chưa đủ quyền thành viên để bình luận trong nhóm', 'Chưa là thành viên nhóm nên không bình luận được.', 'thất bại')]:
    add('err_fb_comment_unavailable_' + suffix, title, fb_sources([10, 11], [14]), meaning,
        aliases=['err_fb_comment_unavailable', 'err_fb_cannot_comment'], detail_status=detail,
        note='Lỗi mục tiêu, không khóa bình luận toàn tài khoản. Bình luận sau duyệt và xử lý bước phụ cần runtime; không tự suy ra bị chặn từ timeout.')

add('err_fb_messenger_unavailable_target_not_messageable', 'Người nhận không thể nhận tin nhắn Facebook', fb_sources([12], [16]),
    'Người nhận cụ thể không cho nhắn hoặc không khả dụng.', aliases=['err_fb_cannot_message (người nhận)'], **target,
    note='Chạy tiếp mục tiêu khác; vẫn kết bạn nếu chiến dịch bật hành động đó. Không khóa nhắn tin toàn tài khoản.')
add('err_fb_messenger_unavailable_e2ee_pin_required', 'Messenger yêu cầu thiết lập PIN hoặc khôi phục tin nhắn', fb_sources([12], [16]),
    'Messenger cần người dùng hoàn tất thiết lập trước khi gửi.', **pending,
    note='Cần chặn các chiến dịch nhắn tin tới khi thiết lập xong. Tài liệu chưa chốt policy mở khóa, nên không suy diễn thời gian/khóa action vô hạn hoặc tạm dừng toàn tài khoản.')
add('err_fb_messenger_unavailable_account_restricted', 'Facebook hạn chế nhắn tin của tài khoản', fb_sources([12], [16]),
    'Có thông báo hạn chế nhắn tin ở cấp tài khoản, không chỉ một người nhận.',
    aliases=['err_fb_message_blocked', 'err_fb_cannot_message (hạn chế tài khoản)'], **pending,
    note='Nguồn đề xuất 24–72 giờ, chưa chốt thời gian và friend/stranger bị chặn. Các trường khóa để trống cho tới khi xác định; không thay err_limit_waiting_message.')
add('err_fb_add_friend_unavailable', 'Không thể gửi lời mời kết bạn Facebook', fb_sources([13], [18]),
    'Không có nút kết bạn, đã loại trừ trạng thái đã là bạn/đã gửi lời mời.', **target,
    note='Không tạo policy lỗi cho đã là bạn/đã gửi lời mời. Chỉ suy ra chặn tài khoản khi có bằng chứng; không khóa chỉ vì một hồ sơ thiếu nút.')

add('err_fb_page_inbox_customer_not_found', 'Không tìm thấy khách trong hộp thư Page', fb_sources([14], [25]),
    'Khách/hội thoại thực sự không còn trong inbox.', detail_status='không tồn tại',
    note='Không tính quota/bad-target; mở theo PSID/thread ID là thay đổi runtime tương lai.')
add('err_fb_page_inbox_wrong_conversation', 'Chưa xác minh được đúng hội thoại khách trên Page', fb_sources([14], [25]),
    'Kết quả tìm kiếm là hội thoại khác hoặc trùng tên; không gửi khi chưa xác minh.', **target,
    note='Không coi sai hội thoại là người nhận không tồn tại. Cần xác minh PSID/thread ID trước gửi.')
for suffix, title, meaning in [
    ('outside_window', 'Hội thoại Page đã ngoài thời hạn trả lời', 'Banner xác nhận đã ngoài thời hạn nhắn tin.'),
    ('blocked_by_user', 'Khách không cho Page gửi tin nhắn', 'Khách đã chặn hoặc không còn cho phép Page trả lời.')]:
    add('err_fb_page_inbox_cannot_reply_' + suffix, title, fb_sources([15], [12]), meaning,
        aliases=['err_fb_page_inbox_cannot_reply'], **target,
        note='Lỗi hội thoại; không khóa toàn tài khoản và không tự gửi lại. Lọc thời hạn cần runtime, không đặt một cửa sổ chung cho mọi Page.')

add('err_fb_join_group_failed_limit', 'Facebook giới hạn tham gia nhóm', fb_sources([16], [31]),
    'Có thông báo giới hạn/chặn tham gia nhóm đã xác nhận.', **pending,
    disable_action_codes=['fb_join_group'], time_disable_actions=1440,
    note='Thời gian 24 giờ lấy trực tiếp từ hai tài liệu; nhận diện popup và trả input cần runtime.')
add('err_fb_join_group_failed_questions_required', 'Nhóm Facebook yêu cầu trả lời câu hỏi tham gia', fb_sources([16], [31]),
    'Chưa hoàn tất câu hỏi hoặc điều kiện tham gia của nhóm.', **target,
    note='Chỉ lỗi nhóm cụ thể, không khóa tài khoản; điền câu hỏi và xác minh kết quả cần runtime.')
add('err_fb_join_group_failed_ui', 'Giao diện tham gia nhóm Facebook chưa xử lý được', fb_sources([16], [31]),
    'Không bấm/xác minh được thao tác tham gia, chưa thấy thông báo giới hạn.', **pending,
    note='Thử lại một lần chỉ khi chắc chắn chưa gửi yêu cầu; không coi timeout là giới hạn tài khoản.')

add('err_fb_post_not_confirmed', 'Chưa xác nhận được kết quả đăng bài Facebook', fb_sources([17], [19]),
    'Đã bấm Đăng nhưng form chưa đóng; chưa biết bài đã được nhận hay chưa.',
    aliases=['err_fb_post_not_published (chưa rõ kết quả)'], detail_status='thất bại', counts_toward_limit=True,
    note='Ưu tiên quy tắc nguồn FACEBOOK_ERROR_HANDLING: xác minh bài đã lên/chờ duyệt trước khi retry; tuyệt đối không suy ra chưa gửi từ timeout. Không tự cấp lịch retry.')
add('err_fb_post_not_published_content_blocked', 'Facebook từ chối nội dung hoặc liên kết bài đăng', fb_sources([17], [19]),
    'Thông báo xác nhận nội dung/link bị từ chối; không dùng cho kết quả chưa rõ.',
    update_status_campaign='tạm dừng', detail_status='thất bại', counts_toward_limit=True,
    note='Nguồn chính đề nghị tạm dừng để sửa nội dung, không retry. Nguồn phụ đề nghị ngưỡng 2 group; không đưa ngưỡng này vào policy vì nguồn chính ưu tiên và schema không có bộ đếm group khác nhau.')
add('err_fb_post_not_published_duplicate', 'Facebook báo nội dung đăng bị trùng', fb_sources([17], [19]),
    'Facebook xác nhận từ chối do nội dung trùng.', detail_status='thất bại', counts_toward_limit=True,
    note='Nguồn chưa chốt dừng chiến dịch/thời gian nghỉ cho lỗi trùng. Không tự đặt ngưỡng, không tự đăng lại; xác minh bài trước khi xử lý tiếp.')
add('err_fb_formatted_content_rejected', 'Facebook không nhận nội dung định dạng', fb_sources([18], [29]),
    'Dán nội dung HTML/định dạng bị từ chối.', aliases=['err_fb_content_format'],
    note='Thử văn bản thuần trước; chỉ tạm dừng khi fallback cũng lỗi. Chưa đặt update_status_campaign=tạm dừng vì DB không biểu diễn được điều kiện đã thử fallback.')
add('err_fb_media_upload_timeout', 'Tải ảnh hoặc video lên Facebook chưa hoàn tất', fb_sources([17, 19], [29]),
    'Media tải chậm/quá hạn trước khi xác nhận đăng.', aliases=['err_fb_post_not_published_upload_pending'], **pending,
    note='Timeout theo dung lượng và thử lại cần runtime. Nếu có thể đã gửi/đăng, phải xác minh trước, không tự retry.')
add('err_fb_composer_editor_not_found', 'Không mở được ô nhập bài đăng Facebook', fb_sources([21], [20]),
    'Đã yêu cầu mở composer nhưng không có editor hoặc bị hộp thoại khác che.', aliases=['err_fb_post_composer_not_open'], **pending,
    note='Đóng popup, nhận diện form mua bán và thử lại có giới hạn cần runtime. Không suy ra checkpoint/chặn từ timeout; không tự đặt thời gian khóa.')
add('err_fb_post_button_not_found', 'Không tìm thấy nút đăng hoặc chia sẻ trên Facebook', fb_sources([22], [28]),
    'Giao diện chưa có nút Đăng/Chia sẻ khả dụng; chưa xác nhận submit.',
    note='Nguồn chính không chốt ngưỡng; nguồn phụ nêu 3 lượt nhưng cần phân biệt upload/popup. Chỉ lưu mô tả, chưa đặt count_consecutive_errors.')
add('err_fb_page_inbox_ui', 'Giao diện hộp thư Page chưa sẵn sàng', fb_sources([15, 23], [12, 26]),
    'Lỗi ô tìm kiếm/soạn tin, nút gửi hoặc xác minh UI; chưa có bằng chứng hội thoại bị cấm trả lời.',
    aliases=['err_fb_page_inbox_cannot_reply_ui_not_ready'], **pending,
    note='Reload/thử lại một lần, phục hồi theo PSID cần runtime. Khoảng chờ 5–10 phút chưa có giá trị duy nhất; không đặt thời gian hoặc ngưỡng mới.')
add('err_fb_upload_form_changed', 'Không tìm thấy form tải media Facebook phù hợp', fb_sources([19], [29]),
    'Không có đúng form/input file cần dùng, khác với media đã tải nhưng bị timeout.', **pending,
    note='Không tiêu hao input/quota. Phát hiện UI đổi, cảnh báo và phục hồi cần runtime.')
add('err_fb_group_invite_ui', 'Giao diện mời bạn vào nhóm Facebook chưa xử lý được', fb_sources([], [32]),
    'Không có form/input/nút mời hoặc không xác nhận được đóng dialog.', **pending,
    note='Bạn bè không tìm thấy vẫn là kết quả không tồn tại, không gộp vào lỗi UI. Nếu đã bấm gửi mời thì xác minh trước khi thử lại; khóa khi có banner giới hạn là nhánh khác.')

shared = [
 ('err_media_file_missing', 'Không dùng được tệp media của chiến dịch', [19], [29], ['err_media_unavailable'], 'File không còn hoặc cloud URL không tải được.', {'update_status_campaign': 'tạm dừng'}, 'Nêu tên file cần sửa. Fallback cloud/upload media cần runtime.'),
 ('err_input_invalid', 'Dữ liệu đầu vào không hợp lệ', [20], [38], ['err_invalid_target'], 'Dòng UID/link/data cụ thể không hợp lệ.', target, 'Bỏ qua dòng sai, không quy lỗi tài khoản; validation cần runtime.'),
 ('err_campaign_config_invalid', 'Cấu hình chiến dịch chưa hợp lệ', [20], [35, 38], ['err_campaign_config'], 'Thiếu từ khóa, media, workflow hoặc lịch bắt buộc.', {'update_status_campaign': 'tạm dừng'}, 'Dừng ngay và nêu trường cần sửa; validation trước chạy cần runtime.'),
 ('err_system_block_load', 'Không tải được block cần chạy', [24], [22], ['err_system_block_missing'], 'Workflow không tìm hoặc không tải được block/elements.', pending, 'Cache/retry/backoff và báo nội bộ cần runtime. Nguồn nêu 1–5 phút, chưa chọn giá trị cụ thể.'),
 ('err_network_offline', 'Kết nối mạng tạm thời gián đoạn', [25], [21], ['err_network'], 'Lỗi kết nối Chromium, DNS hoặc mạng thay đổi; chưa xác định là lỗi proxy.', pending, 'Backoff 1→5→15 phút là đề xuất runtime; không biến thành khóa action. Nếu kết quả gửi chưa rõ thì xác minh trước retry.'),
 ('err_proxy_failed', 'Proxy của tài khoản không kết nối được', [25], [21], ['err_proxy'], 'Lỗi tunnel/chứng chỉ đã xác định liên quan proxy.', pending, 'Chỉ đánh dấu proxy khi xác minh nguyên nhân và số lần lặp; không thêm trạng thái tài khoản hoặc ngưỡng mới.'),
 ('err_ai_service_unavailable', 'Dịch vụ AI tạm thời không xử lý được yêu cầu', [27], [35], ['err_ai_service'], 'AI hết số dư, timeout hoặc không trả nội dung.', pending, 'Fallback/báo admin cần runtime. Không tự tắt lọc AI hoặc thay hành vi chiến dịch.'),
 ('err_device_sleep', 'Thiết bị tạm ngừng kết nối khi ngủ', [], [21], [], 'ERR_NETWORK_IO_SUSPENDED và tình trạng sleep đã xác nhận.', pending, 'Dừng runtime và tiếp tục khi resume cần code; không khóa Facebook.'),
 ('err_runtime_browser', 'Trình duyệt thực thi bị gián đoạn', [], [36], [], 'WebContents/object đã bị hủy, node không còn hoặc script runtime timeout.', pending, 'Tạo lại browser/retry cần code. Kết quả gửi chưa xác định không được tự gửi lại.'),
 ('err_server_unreachable', 'Chưa kết nối được máy chủ akaBiz', [], [36], [], 'Không đọc/ghi được dữ liệu hoặc schema cache API không sẵn sàng.', pending, 'Bàn giao cleanup, backoff và dừng scheduler khi mất server kéo dài cần code; không thêm pool hay RPC.')
]
for code, title, a, b, aliases, meaning, fields, note in shared:
    add(code, title, fb_sources(a, b), meaning, aliases=aliases, note=note, kind='system', **fields)


def convert(value):
    if value == 'NULL': return None
    if value == 'false': return False
    if value == 'true': return True
    return value


email_columns = ['error_code', None, 'error_type', 'error_name', 'noti_running_process', 'noti_campaign',
                 'update_status_account', 'update_status_campaign', 'update_login_status', 'disable_action_codes',
                 'disable_action_mode', 'time_disable_actions', 'count_consecutive_errors', 'detail_status',
                 'counts_toward_limit', 'counts_toward_bad_target']
for number in range(2, 15):
    row = email[number - 1]
    if row[0] in existing:
        continue
    fields = {key: convert(row[i]) for i, key in enumerate(email_columns) if key}
    fields['disable_action_codes'] = [v for v in fields['disable_action_codes'].strip('{}').split(',') if v]
    code, title, kind = fields.pop('error_code'), fields.pop('error_name'), fields.pop('error_type')
    add(code, title, [source_row(2, 'Cấu hình auto_error', number, row, list(range(17)))],
        'Email: ' + str(row[16]), kind=kind, **fields,
        note='Cấu hình lấy nguyên từ sheet Cấu hình auto_error. Mapping SMTP phải xét responseCode/enhanced code/command/response, chưa triển khai. Không retry tự động nếu SMTP đã có thể nhận thư; không ghi mã SMTP vào cột Zalo.')

assert sum(x['policy']['error_code'].startswith('err_email_') for x in catalog) == 12
assert all(x['policy']['is_active'] and not x['policy']['is_delete'] for x in catalog)
skipped = sorted(existing & {'err_logout', 'error_limit_in_day', 'error_limit_in_hour', 'err_undefined',
    'err_limit_waiting_message', 'err_group_post_frequency_limit', 'err_comment_frequency_limit', 'err_email_recipient_not_found'})
source_manifest = [{'file': f, 'sha256': hashlib.sha256((SOURCE / f).read_bytes()).hexdigest()} for f in FILES]
(DEST / 'catalog.json').write_text(json.dumps({'sources': source_manifest, 'skipped_existing': skipped,
    'excluded_non_errors': ['run_cancelled', 'run_abandoned', 'thành công (chờ duyệt)', 'đã là bạn bè', 'đã gửi lời mời'],
    'entries': catalog}, ensure_ascii=False, indent=2) + '\n')
(DEST / 'desired.json').write_text(json.dumps([entry['policy'] for entry in catalog], ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'total': len(catalog), 'facebook': sum(x['policy']['error_type'] == 'external facebook' for x in catalog),
                  'shared': len(shared), 'email': 12, 'skipped_existing': skipped}, ensure_ascii=False))
