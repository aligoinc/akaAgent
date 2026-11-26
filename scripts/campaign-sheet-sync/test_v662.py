#!/usr/bin/env python3
"""Bài kiểm V662 (đồng bộ Google Sheet vào data chiến dịch) trên Postgres cục bộ.

Chạy: python3 scripts/campaign-sheet-sync/test_v662.py   (cần Postgres 16/17; PG_BIN để chỉ thư mục bin)
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from pg import Cluster  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
MIGRATION = open(os.path.join(ROOT, 'migrations/migration_v662_campaign_sheet_sync.sql'), encoding='utf-8').read()
ROLLBACK = open(os.path.join(ROOT, 'migrations/rollback_v662_campaign_sheet_sync.sql'), encoding='utf-8').read()
FIXTURE = open(os.path.join(os.path.dirname(__file__), 'fixture.sql'), encoding='utf-8').read()

passed = 0


def ok(cond, label):
    global passed
    if not cond:
        raise AssertionError(label)
    passed += 1
    print('PASS', label)


def q(value):
    return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::jsonb"


CONFIG = {'url': 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=0', 'hasHeader': True,
          'mapping': {'phone': 0, 'name': 1}, 'expectedHeaders': ['SĐT', 'Tên'], 'columnCount': 2,
          'phonePolicy': 'first', 'targetField': 'phone', 'platform': 'zalo'}


def main():
    pg = Cluster()
    try:
        run(pg)
    finally:
        pg.stop()
    print(f'\n{passed} PASS')


def desk(pg, staff, payload):
    return pg.json(f"BEGIN; SET LOCAL ROLE aka_agent_desktop; SET LOCAL test.staff = '{staff}';"
                   f" SELECT public.aka_agent_campaign_sheet_sync({q(payload)}); COMMIT;")


def desk_err(pg, staff, payload):
    return pg.error(f"BEGIN; SET LOCAL ROLE aka_agent_desktop; SET LOCAL test.staff = '{staff}';"
                    f" SELECT public.aka_agent_campaign_sheet_sync({q(payload)}); COMMIT;")


def svc(pg, sql):
    return pg.one(f"BEGIN; SET LOCAL ROLE service_role; SELECT ({sql})::text; COMMIT;")


def claim(pg):
    raw = svc(pg, 'public.aka_agent_campaign_sheet_claim()')
    return json.loads(raw) if raw else None


def finish(pg, token, result):
    return json.loads(svc(pg, f"public.aka_agent_campaign_sheet_finish('{token}'::uuid, {q(result)})"))


def rows(*phones):
    return [{'phone': p, 'name': f'Khách {i}'} for i, p in enumerate(phones)]


def due(pg, sync_id):
    pg.psql(f"UPDATE auto_campaign_sheet_syncs SET next_run_at = now() - interval '1 second' WHERE id = {sync_id}")


def run(pg):
    pg.psql(FIXTURE)
    pg.psql(MIGRATION)
    ok(pg.one("SELECT count(*) FROM pg_class WHERE relname IN ('auto_campaign_sheet_syncs','auto_campaign_sheet_sync_logs')") == '2',
       'migration tạo 2 bảng')
    ok(pg.error(MIGRATION) is not None, 'chạy lại migration bị từ chối')
    ok(pg.one("SELECT value FROM auto_system_settings WHERE key='campaign.sheet_sync'").startswith('{"audience":"off"'),
       'cài đặt mặc định: ẩn ô, worker tắt')
    ok(pg.one("SELECT position('Campaign Sheet dispatch' in prosrc) > 0 FROM pg_proc WHERE proname='aka_agent_data_group_background_tick'") == 't',
       'hàm tick có khối dispatch chiến dịch')

    # Khoá so trùng: cùng luật với cửa sổ Upload (tìm ra bằng bộ thử ngẫu nhiên + data thật 26/11).
    def key(field, action, value):
        return pg.one(f"SELECT coalesce(private.aka_agent_campaign_sheet_key('{field}', '{action}', $v${value}$v$, $v${value}$v$, $v${value}$v$), '∅')")
    ok(key('uid', 'facebook_group_post', 'https://www.facebook.com/groups/123/') == 'https://www.facebook.com/groups/123', 'UID Facebook bỏ "/" cuối như app')
    ok(key('uid', 'facebook_message_uid', ' Đoàn  Phóng ') == 'ĐoànPhóng', 'UID bỏ mọi khoảng trắng như app')
    ok(key('uid', 'zalo_message_group_member', '5353486665/') == '∅' and key('uid', 'zalo_message_group_member', '5353 486665') == '5353486665',
       'UID Zalo chỉ nhận chữ số (app coi "/" là sai)')
    ok(key('uid', 'zalo_join_group_link', 'ZALO.ME/G/AbC?src=qr') == 'https://zalo.me/g/AbC', 'link group Zalo về dạng chuẩn')
    ok(key('uid', 'facebook_find_data_search', '\u00a0BÁN  NHÀ\t') == 'bán nhà', 'từ khoá: chữ thường tiếng Việt, gộp khoảng trắng kiểu JS')
    ok(key('email', 'email_send', 'mailto:a@x.vn') == '∅' and key('email', 'email_send', ' A.B@X.VN ') == 'a.b@x.vn', 'email theo luật của app')
    ok(key('uid', 'facebook_group_post', 'x' * 2049) == '∅', 'UID quá 2.048 ký tự: không nhận, không cắt')

    # Quyền.
    for role, fn in [('anon', 'public.aka_agent_campaign_sheet_finish(uuid,jsonb)'), ('authenticated', 'public.aka_agent_campaign_sheet_claim()'),
                     ('aka_agent_desktop', 'public.aka_agent_campaign_sheet_claim()'),
                     ('aka_agent_desktop', 'public.aka_agent_control_campaign_sheet_sync(bigint,bigint,jsonb)'),
                     ('anon', 'public.aka_agent_campaign_sheet_sync(jsonb)'),
                     ('aka_agent_desktop', 'private.aka_agent_campaign_sheet_sync_core(bigint,bigint,boolean,jsonb)')]:
        ok(pg.one(f"SELECT has_function_privilege('{role}', '{fn}', 'EXECUTE')") == 'f', f'{role} không gọi được {fn}')
    ok(pg.one("SELECT has_table_privilege('aka_agent_desktop','public.auto_campaign_sheet_syncs','SELECT')") == 'f',
       'Desktop không đọc thẳng bảng')

    pg.psql("""
      INSERT INTO org_staff (id, organization_id) VALUES (10, 1), (11, 2), (12, 1);
      INSERT INTO auto_campaigns (id, staff_id, organization_id, action_id, name, status) VALUES
        (100, 10, 1, 'zalo_message_phone', 'A', 'đang chạy'), (101, 10, 1, 'zalo_message_phone', 'B', 'hoàn thành'),
        (102, 10, 1, 'sms_send', 'SMS', 'chờ xử lý'), (103, 11, 2, 'zalo_message_phone', 'Khác', 'chờ xử lý'),
        (104, 10, 1, 'zalo_message_phone', 'C', 'chờ xử lý'), (105, 10, 1, 'zalo_message_phone', 'D', 'chờ xử lý'),
        (106, 10, 1, 'zalo_message_phone', 'DG', 'chờ xử lý'), (107, 10, 1, 'email_send', 'E', 'chờ xử lý');
      INSERT INTO auto_campaign_input_data (campaign_id, phone) VALUES (100, '0912345678'), (101, '0911111111');
      INSERT INTO auto_campaign_input_data (campaign_id, phone, is_delete) VALUES (101, '0922222222', true);
      INSERT INTO auto_campaign_data_group_sources (campaign_id, group_id, status) VALUES (106, 1, 'active');
    """)

    base = {'action': 'save', 'requestId': 'req-1', 'campaignIds': [100, 101], 'config': CONFIG, 'everyHours': 6,
            'endDate': time.strftime('%Y-%m-%d', time.gmtime(time.time() + 30 * 86400)), 'splitMode': 'split',
            'sheetValues': ['0912345678', '0911111111', '0987654321']}
    ok('sheet_sync_unavailable' in desk_err(pg, 10, base), 'audience off: không lưu được')
    ok(desk(pg, 10, {'action': 'settings'})['available'] is False, 'settings: available false khi off')
    pg.psql("UPDATE auto_system_settings SET value = '{\"audience\":\"all\",\"worker\":false,\"maxSourcesPerStaff\":2,\"minEveryHours\":1}' WHERE key='campaign.sheet_sync'")
    ok(desk(pg, 10, {'action': 'settings'})['available'] is True, 'settings: available true khi all')
    ok('sheet_sync_unauthorized' in pg.error(f"SELECT public.aka_agent_campaign_sheet_sync({q({'action': 'settings'})})"),
       'không có phiên Desktop thì từ chối')

    ok('sheet_sync_campaign_invalid' in desk_err(pg, 10, {**base, 'requestId': 'r-sms', 'campaignIds': [102]}), 'SMS chưa bật được')
    ok('sheet_sync_campaign_invalid' in desk_err(pg, 10, {**base, 'requestId': 'r-other', 'campaignIds': [103]}), 'chiến dịch nhân viên khác')
    ok('sheet_sync_campaign_invalid' in desk_err(pg, 10, {**base, 'requestId': 'r-dg', 'campaignIds': [106]}), 'chiến dịch chạy bằng Nhóm data')
    ok('sheet_sync_end_date' in desk_err(pg, 10, {**base, 'requestId': 'r-end', 'endDate': '2099-01-01'}), 'ngày dừng quá 365 ngày')
    ok('sheet_sync_every_hours' in desk_err(pg, 10, {**base, 'requestId': 'r-h', 'everyHours': 30}), 'chu kỳ quá 24 giờ')
    ok('sheet_sync_config' in desk_err(pg, 10, {**base, 'requestId': 'r-c', 'config': {**CONFIG, 'url': 'https://evil.example/x'}}), 'link không phải Google Sheet')
    ok('sheet_sync_config' in desk_err(pg, 10, {**base, 'requestId': 'r-c2', 'config': {**CONFIG, 'mapping': {'name': 1}}}), 'ghép cột thiếu cột SĐT')

    saved = desk(pg, 10, base)
    sync = saved['sync']
    sid = sync['id']
    ok(sync['status'] == 'pending' and sync['campaignIds'] == [100, 101] and not saved['replayed'], 'tạo nguồn')
    ok(pg.one(f"SELECT skipped_keys::text FROM auto_campaign_sheet_syncs WHERE id={sid}") == '{0987654321}',
       'mốc: chỉ dòng đã đọc mà chưa có trong data')
    ok(desk(pg, 10, base)['replayed'] is True, 'gửi lại cùng mã yêu cầu trả nguồn cũ')
    ok('sheet_sync_conflict' in desk_err(pg, 10, {**base, 'everyHours': 3}), 'cùng mã yêu cầu khác nội dung')
    ok('sheet_sync_campaign_taken' in desk_err(pg, 10, {**base, 'requestId': 'req-2', 'campaignIds': [100]}), 'chiến dịch đã thuộc nguồn khác')
    ok(desk(pg, 10, {'action': 'state', 'campaignId': 100})['sync']['id'] == sid, 'state theo chiến dịch')
    ok(desk(pg, 12, {'action': 'state', 'campaignId': 100})['sync'] is None, 'nhân viên khác không thấy')
    listed = desk(pg, 10, {'action': 'list', 'campaignIds': [100, 101, 104]})['items']
    ok(sorted(i['campaignId'] for i in listed) == [100, 101], 'list trả đúng chiến dịch đang đồng bộ')

    # Worker tắt.
    ok(pg.one('SELECT public.aka_agent_campaign_sheet_dispatch()::text') == '', 'worker tắt: không gọi Edge')
    ok(claim(pg) is None, 'worker tắt: không nhận')
    pg.psql("UPDATE auto_system_settings SET value = '{\"audience\":\"all\",\"worker\":true,\"maxSourcesPerStaff\":2}' WHERE key='campaign.sheet_sync'")
    pg.psql("SELECT public.aka_agent_data_group_background_tick()")
    ok(pg.one("SELECT count(*) FROM net.calls WHERE url LIKE '%aka-agent-campaign-sheet-sync'") == '1', 'tick gọi Edge khi có nguồn đến hạn')

    job = claim(pg)
    ok(job and job['syncId'] == sid and job['config']['targetField'] == 'phone', 'claim trả nguồn')
    ok(pg.one('SELECT public.aka_agent_campaign_sheet_dispatch()::text') == '', 'đang có lượt chạy thì không gọi thêm Edge')
    ok(claim(pg) is None, 'nguồn đang giữ thì không nhận lần hai')
    result = finish(pg, job['token'], {'rows': rows('0912345678', '0987654321', '0901111111', '0902222222', '0903333333',
                                                     '+84904444444', 'abc', '0922222222', '0911111111'),
                                        'rowCount': 11, 'invalid': 1, 'duplicates': 1})
    ok(result['ok'] and result['added'] == 4, f'thêm 4 dòng mới ({result})')
    ok(result['invalid'] == 2, 'không hợp lệ = 1 của bộ đọc + 1 dòng "abc"')
    counts = pg.json("SELECT json_object_agg(campaign_id, n) FROM (SELECT campaign_id, count(*) n FROM auto_campaign_input_data WHERE is_delete=false GROUP BY 1) x")
    ok(counts == {'100': 3, '101': 3}, f'chia lần lượt 2 / 2 ({counts})')
    ok(pg.one("SELECT count(*) FROM auto_campaign_input_data WHERE phone = '0922222222'") == '1', 'dòng khách đã xoá không thêm lại')
    ok(pg.one("SELECT status FROM auto_campaigns WHERE id=101") == 'chờ xử lý', 'chiến dịch hoàn thành được mở lại')
    ok(pg.one("SELECT status FROM auto_campaigns WHERE id=100") == 'đang chạy', 'chiến dịch đang chạy giữ trạng thái')
    ok(pg.one("SELECT count(*) FROM auto_campaign_logs WHERE log LIKE '%Đồng bộ Google Sheet: đã thêm 2 data mới'") == '2', 'dòng tiến trình mỗi chiến dịch')
    st = desk(pg, 10, {'action': 'state', 'campaignId': 100})['sync']
    ok(st['status'] == 'success' and st['lastAdded'] == 4 and st['totalAdded'] == 4, 'nguồn ghi kết quả')
    ok(sum(c['added'] for c in st['campaigns']) == 4, 'campaigns[].added cộng đúng')
    again = finish(pg, job['token'], {'rows': rows('0905555555'), 'rowCount': 1, 'invalid': 0})
    ok(again == result, 'gọi lại finish cùng token trả kết quả cũ, không thêm')
    ok(pg.one("SELECT count(*) FROM auto_campaign_input_data") == '7', 'không có dòng thừa')
    runs = desk(pg, 10, {'action': 'runs', 'syncId': sid})['runs']
    ok(runs[0]['kind'] == 'run' and runs[0]['added'] == 4 and runs[-1]['kind'] == 'enable', 'log có lượt chạy và lần bật')

    # Lượt kế: chỉ dòng mới, con trỏ chia tiếp.
    due(pg, sid)
    job = claim(pg)
    result = finish(pg, job['token'], {'rows': rows('0901111111', '0906666666'), 'rowCount': 2, 'invalid': 0})
    ok(result['added'] == 1, 'lượt kế chỉ thêm dòng mới')

    # Tắt / bật lại theo chiến dịch.
    st = desk(pg, 10, {'action': 'stop', 'syncId': sid, 'campaignId': 100})['sync']
    ok(st['campaignIds'] == [101] and st['isEnabled'], 'tắt cho một chiến dịch, nguồn còn chạy cho chiến dịch kia')
    ok(desk(pg, 10, {'action': 'state', 'campaignId': 100})['active'] is False, 'state: chiến dịch đã rời')
    st = desk(pg, 10, {'action': 'stop', 'syncId': sid, 'campaignId': 101})['sync']
    ok(st['campaignIds'] == [] and not st['isEnabled'] and st['status'] == 'paused', 'tắt hết thì nguồn dừng')
    st = desk(pg, 10, {'action': 'resume', 'syncId': sid, 'campaignId': 100})['sync']
    ok(st['campaignIds'] == [100] and st['isEnabled'] and st['status'] == 'pending', 'bật lại')

    # Lỗi tạm thời / lỗi phải sửa.
    job = claim(pg)
    r = finish(pg, job['token'], {'error': {'code': 'sheet_read_failed', 'message': 'Mạng lỗi', 'permanent': False}})
    st = desk(pg, 10, {'action': 'state', 'campaignId': 100})['sync']
    ok(not r['ok'] and st['status'] == 'retry' and st['retryCount'] == 1 and st['isEnabled'], 'lỗi tạm thời: thử lại')
    due(pg, sid)
    job = claim(pg)
    finish(pg, job['token'], {'error': {'code': 'sheet_columns_changed', 'message': 'Cột của Sheet đã thay đổi.', 'permanent': True}})
    st = desk(pg, 10, {'action': 'state', 'campaignId': 100})['sync']
    ok(st['status'] == 'error' and not st['isEnabled'] and st['stoppedReason'] == 'sheet_columns_changed', 'lỗi cột: dừng')
    ok('sheet_sync_requires_save' in desk_err(pg, 10, {'action': 'resume', 'syncId': sid, 'campaignId': 100}), 'lỗi cột: phải Sửa')
    edit = {'action': 'save', 'syncId': sid, 'expectedRevision': st['revision'], 'config': CONFIG, 'everyHours': 12,
            'endDate': base['endDate'], 'splitMode': 'split', 'sheetValues': ['0907777777']}
    st = desk(pg, 10, edit)['sync']
    ok(st['status'] == 'pending' and st['everyHours'] == 12 and st['isEnabled'], 'Sửa: chạy lại')
    ok('0907777777' in pg.one(f"SELECT skipped_keys::text FROM auto_campaign_sheet_syncs WHERE id={sid}"), 'Sửa: thêm mốc mới')
    ok('sheet_sync_conflict' in desk_err(pg, 10, edit), 'Sửa với phiên bản cũ bị từ chối')

    # Lượt đang chạy bị Sửa: finish cũ không ghi.
    job = claim(pg)
    st = desk(pg, 10, {'action': 'state', 'campaignId': 100})['sync']
    desk(pg, 10, {**edit, 'expectedRevision': st['revision'], 'everyHours': 6})
    ok(finish(pg, job['token'], {'rows': rows('0908888888'), 'rowCount': 1, 'invalid': 0}).get('stale') is True, 'lượt bị cấu hình lại: stale')
    ok(pg.one("SELECT count(*) FROM auto_campaign_input_data WHERE phone='0908888888'") == '0', 'lượt stale không thêm data')

    # Giới hạn số nguồn (2).
    second = {**base, 'requestId': 'req-3', 'campaignIds': [104], 'sheetValues': []}
    desk(pg, 10, second)
    ok('sheet_sync_limit' in desk_err(pg, 10, {**base, 'requestId': 'req-4', 'campaignIds': [105], 'sheetValues': []}), 'quá số nguồn')

    # Chiến dịch bị xoá: rời nguồn, hết chiến dịch thì nguồn dừng.
    s2 = desk(pg, 10, {'action': 'state', 'campaignId': 104})['sync']['id']
    pg.psql(f"UPDATE auto_campaigns SET is_delete = true WHERE id = 104; UPDATE auto_campaign_sheet_syncs SET next_run_at = now() + interval '1 hour' WHERE id = {sid}")
    ok(claim(pg) is None, 'chiến dịch xoá: không có việc')
    st = desk(pg, 10, {'action': 'state', 'campaignId': 104})['sync']
    ok(st['status'] == 'paused' and st['campaigns'][0]['leftReason'] == 'campaign_deleted', 'nguồn dừng vì chiến dịch đã xoá')

    # Hết hạn.
    pg.psql(f"UPDATE auto_campaign_sheet_syncs SET end_date = current_date - 2, next_run_at = now() - interval '1 second' WHERE id = {sid}")
    ok(claim(pg) is None, 'hết hạn: không nhận')
    st = desk(pg, 10, {'action': 'state', 'campaignId': 100})['sync']
    ok(st['status'] == 'expired' and not st['isEnabled'], 'nguồn hết hạn')
    st = desk(pg, 10, {'action': 'resume', 'syncId': sid, 'campaignId': 100, 'endDate': base['endDate']})['sync']
    ok(st['status'] == 'pending', 'gia hạn bằng resume + ngày mới')

    # Chế độ "mỗi chiến dịch nhận đủ" + email.
    pg.psql("DELETE FROM auto_campaign_sheet_syncs WHERE id <> 0")
    pg.psql("INSERT INTO auto_campaigns (id, staff_id, organization_id, action_id, name) VALUES (108, 10, 1, 'email_send', 'E2');"
            "INSERT INTO auto_campaign_input_data (campaign_id, email) VALUES (107, 'a@x.vn')")
    cfg = {**CONFIG, 'mapping': {'email': 0}, 'targetField': 'email', 'platform': 'email'}
    s3 = desk(pg, 10, {**base, 'requestId': 'req-e', 'campaignIds': [107, 108], 'config': cfg, 'splitMode': 'all', 'sheetValues': []})['sync']['id']
    job = claim(pg)
    r = finish(pg, job['token'], {'rows': [{'email': 'A@x.vn'}, {'email': 'b@x.vn'}, {'email': 'bad'}], 'rowCount': 3, 'invalid': 0})
    ok(r['added'] == 3, f'mỗi chiến dịch nhận đủ: 107 chỉ thêm b, 108 thêm a + b ({r})')
    ok(pg.one("SELECT string_agg(campaign_id||':'||email, ',' ORDER BY campaign_id, email) FROM auto_campaign_input_data WHERE email IS NOT NULL")
       == '107:a@x.vn,107:b@x.vn,108:a@x.vn,108:b@x.vn', 'email so chữ thường')

    # Hiệu năng: chiến dịch 60.000 dòng, Sheet 10.000 dòng.
    pg.psql("DELETE FROM auto_campaign_sheet_syncs; INSERT INTO auto_campaigns (id, staff_id, organization_id, action_id, name) VALUES (200, 10, 1, 'zalo_message_phone', 'Big');"
            "INSERT INTO auto_campaign_input_data (campaign_id, phone) SELECT 200, '09' || lpad(g::text, 8, '0') FROM generate_series(1, 60000) g;"
            "ANALYZE auto_campaign_input_data;")
    desk(pg, 10, {**base, 'requestId': 'req-big', 'campaignIds': [200], 'sheetValues': []})
    job = claim(pg)
    big = [{'phone': '09' + str(g).zfill(8)} for g in range(55001, 65001)]
    t0 = time.time()
    r = finish(pg, job['token'], {'rows': big, 'rowCount': 10000, 'invalid': 0})
    dt = time.time() - t0
    ok(r['added'] == 5000, f'60.000 dòng + Sheet 10.000: thêm 5.000 ({dt:.2f} giây)')
    ok(dt < 15, 'finish đủ nhanh')

    # Dọn log cũ.
    pg.psql("UPDATE auto_campaign_sheet_sync_logs SET created_at = now() - interval '31 days'")
    pg.one('SELECT public.aka_agent_campaign_sheet_dispatch()::text')
    ok(pg.one("SELECT count(*) FROM auto_campaign_sheet_sync_logs") == '0', 'log quá 30 ngày được dọn')

    # Gỡ.
    pg.psql(ROLLBACK)
    ok(pg.one("SELECT count(*) FROM pg_class WHERE relname LIKE 'auto_campaign_sheet%'") == '0', 'gỡ xoá bảng')
    ok(pg.one("SELECT position('Campaign Sheet dispatch' in prosrc) = 0 FROM pg_proc WHERE proname='aka_agent_data_group_background_tick'") == 't',
       'gỡ trả hàm tick về bản cũ')
    ok(pg.one("SELECT md5(pg_get_functiondef('public.aka_agent_data_group_background_tick()'::regprocedure))") == '10a2465bf8273b269ed5123344cff4db',
       'hàm tick sau gỡ trùng md5 production')


if __name__ == '__main__':
    main()
